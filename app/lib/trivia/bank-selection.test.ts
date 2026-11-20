// @vitest-environment node
// Question selection with the DB-backed bank: exposed questions (in public git history) are avoided by the web daily and
// the Discord picker while unexposed ones are left; an empty or unreachable bank makes the cron and the daily no-op
// (nothing stored, posted or paid). Fixture bank behind the in-memory store; Prisma is a small fake.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  rounds: [] as { id: number; dayKey: string | null; questionId: string; surface: string; status?: string }[],
  recentDaily: [] as { questionId: string }[],
  dueDiscord: [] as { id: number; questionId: string; channelId: string | null; messageId: string | null; rewardPep: number; openedAt: Date; closesAt: Date }[],
  transactions: 0,
  writes: 0,
}));
vi.mock("@/app/lib/db", () => ({
  prisma: {
    triviaRound: {
      findUnique: vi.fn(async ({ where }: { where: { dayKey: string } }) => db.rounds.find((r) => r.dayKey === where.dayKey) ?? null),
      findMany: vi.fn(async ({ where }: { where: { surface: string } }) => (where.surface === "WEB_DAILY" ? db.recentDaily : db.dueDiscord)),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: { dayKey: string | null; questionId: string; surface: string } }) => {
        db.writes++;
        const row = { id: db.rounds.length + 1, ...data };
        db.rounds.push(row);
        return row;
      }),
      update: vi.fn(async () => {
        db.writes++;
        return {};
      }),
      updateMany: vi.fn(async () => {
        db.writes++;
        return { count: 1 };
      }),
    },
    triviaAttempt: {
      deleteMany: vi.fn(async () => {
        db.writes++;
        return { count: 0 };
      }),
    },
    $transaction: vi.fn(async (arg: unknown) => {
      db.transactions++;
      if (typeof arg === "function") {
        const tx = {
          $queryRaw: async () => [{ locked: true }],
          triviaRound: { findFirst: async () => null, create: async () => ({ id: 77 }) },
        };
        return (arg as (t: typeof tx) => unknown)(tx);
      }
      return Promise.all(arg as Promise<unknown>[]);
    }),
  },
}));
vi.mock("./reports", async (importActual) => ({ ...(await importActual<typeof import("./reports")>()), getDisabledIds: vi.fn(async () => [] as string[]) }));
vi.mock("@/app/lib/settings/toggles", () => ({ toggleEnabled: vi.fn(async () => true) }));
vi.mock("./channel", () => ({
  resolveTriviaChannel: vi.fn(async () => "840000000000000001"),
  triviaSettings: vi.fn(async () => ({ rewardPep: 20, webDailyRewardPep: 0, dryRun: false, roundsPerDay: 3 })),
}));

import { fakeBank } from "./__fixtures__/fake-bank-store";
import { getBank, invalidateBank, servable } from "./bank";
import { dailyQuestionFor, dayKeyUtc } from "./daily";
import { pickDailyQuestion, preferUnexposed } from "./exposed";
import { pickQuestion, slotsForDay } from "./schedule";
import { announceWin, expireRounds, openDiscordRound } from "./rounds";
import { prisma } from "@/app/lib/db";
import { getDailyRound, practicePool, practicePoolOrNull, resetRecentDailyCache } from "./web";
import { runTriviaCron } from "./cron";
import type { TriviaQuestion } from "./schema";

const NOW = new Date("2026-11-20T12:00:00Z");
const TODAY = dayKeyUtc(NOW);

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  fakeBank.reset();
  invalidateBank();
  db.rounds = [];
  db.recentDaily = [];
  db.dueDiscord = [];
  resetRecentDailyCache();
  db.transactions = 0;
  db.writes = 0;
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const ids = (qs: readonly TriviaQuestion[]) => new Set(qs.map((q) => q.id));
const fakePost = () => {
  const posted: string[] = [];
  return { posted, deps: { post: vi.fn(async (_c: string, b: { content?: string }) => (posted.push(b.content ?? ""), { id: "999" })) } };
};

describe("preferUnexposed", () => {
  it("keeps the unexposed part, or everything (with a warning) when none is left", async () => {
    const pool = await servable({ pool: "discord" });
    expect(preferUnexposed(pool, new Set(), "x")).toEqual(pool);
    const exposed = new Set(pool.slice(1).map((q) => q.id));
    expect(preferUnexposed(pool, exposed, "x").map((q) => q.id)).toEqual([pool[0].id]);
    expect(warn).not.toHaveBeenCalled();
    expect(preferUnexposed(pool, ids(pool), "x")).toEqual(pool);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("Discord picker", () => {
  it("never picks an exposed question while an unexposed one is a candidate", async () => {
    const pool = await servable({ pool: "discord" });
    const fresh = pool.filter((q) => q.id === "pd-909" || q.id === "eb-924");
    const exposed = new Set(pool.filter((q) => !fresh.includes(q)).map((q) => q.id));
    for (let i = 0; i < 100; i++) expect(["pd-909", "eb-924"]).toContain(pickQuestion(pool, { recentIds: [], exposedIds: exposed })!.id);
  });

  it("falls back to exposed ones when the unexposed ones were all used recently (no tight repeat loop)", async () => {
    const pool = await servable({ pool: "discord" });
    const exposed = new Set(pool.filter((q) => q.id !== "pd-909").map((q) => q.id));
    for (let i = 0; i < 50; i++) {
      const p = pickQuestion(pool, { recentIds: ["pd-909"], exposedIds: exposed })!;
      expect(p.id).not.toBe("pd-909");
    }
    expect(warn).toHaveBeenCalled();
  });

  it("openDiscordRound picks from the unexposed questions of the DB bank", async () => {
    const pool = await servable({ pool: "discord" });
    fakeBank.setExposed(pool.filter((q) => q.id !== "eb-924").map((q) => q.id));
    invalidateBank();
    for (let i = 0; i < 10; i++) {
      const { deps } = fakePost();
      const r = await openDiscordRound({ channelId: "1", rewardPep: 20, now: NOW, disabledIds: [] }, deps);
      expect(r).toMatchObject({ ok: true, questionId: "eb-924" });
    }
  });
});

describe("web daily", () => {
  it("with nothing exposed it is exactly the hash pick (unchanged behaviour)", async () => {
    const pool = await servable({ now: NOW, pool: "web" });
    for (const day of ["2026-11-20", "2026-11-21", "2027-02-02"]) {
      expect(pickDailyQuestion(day, pool, { exposedIds: new Set(), recentIds: ["pd-901"] })).toBe(dailyQuestionFor(day, pool));
    }
    const round = await getDailyRound(NOW);
    expect(round!.question.id).toBe(dailyQuestionFor(TODAY, pool)!.id);
  });

  it("prefers unexposed questions not used as a recent daily, and is stable for the day", async () => {
    const pool = await servable({ now: NOW, pool: "web" });
    const fresh = ["pd-904", "eb-913"];
    const exposed = new Set(pool.filter((q) => !fresh.includes(q.id)).map((q) => q.id));
    const a = pickDailyQuestion(TODAY, pool, { exposedIds: exposed, recentIds: [] })!;
    expect(fresh).toContain(a.id);
    expect(pickDailyQuestion(TODAY, [...pool].reverse(), { exposedIds: exposed, recentIds: [] })!.id).toBe(a.id);
    // yesterday used one of them: today gets the other
    const b = pickDailyQuestion(TODAY, pool, { exposedIds: exposed, recentIds: ["pd-904"] })!;
    expect(b.id).toBe("eb-913");
    // both used recently: an exposed one that is not recent, with a warning
    const c = pickDailyQuestion(TODAY, pool, { exposedIds: exposed, recentIds: ["pd-904", "eb-913"] })!;
    expect(exposed.has(c.id)).toBe(true);
    expect(warn).toHaveBeenCalled();
  });

  it("getDailyRound and practice use the same pick, reading the recent dailies", async () => {
    const pool = await servable({ now: NOW, pool: "web" });
    fakeBank.setExposed(pool.filter((q) => q.id !== "eb-913" && q.id !== "pd-904").map((q) => q.id));
    invalidateBank();
    db.recentDaily = [{ questionId: "eb-913" }];
    const round = await getDailyRound(NOW);
    expect(round!.question.id).toBe("pd-904");
    expect(db.rounds[0]).toMatchObject({ dayKey: TODAY, questionId: "pd-904" });
    expect((await practicePool(NOW)).some((q) => q.id === "pd-904")).toBe(false); // practice never serves today's daily
    expect((await practicePool(NOW)).some((q) => q.id === "pd-901")).toBe(true); // exposed ones are fine in practice
  });
});

describe("empty or unreachable bank: everything no-ops", () => {
  it("openDiscordRound: no_question, no transaction, no post", async () => {
    fakeBank.set([]);
    invalidateBank();
    const { deps, posted } = fakePost();
    expect(await openDiscordRound({ channelId: "1", rewardPep: 20, now: NOW }, deps)).toEqual({ ok: false, reason: "no_question" });
    expect(db.transactions).toBe(0);
    expect(posted).toEqual([]);
    expect(warn.mock.calls.some((c: unknown[]) => String(c[0]).includes("bank is empty"))).toBe(true);
  });

  it("the cron tick at a due slot: no_question, nothing written or posted", async () => {
    const saved = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = "production";
    try {
      fakeBank.fail = new Error("connection refused");
      invalidateBank();
      const due = new Date(slotsForDay("2026-12-10", 3)[0] + 120_000);
      const { deps, posted } = fakePost();
      const res = await runTriviaCron(due, deps);
      expect(res).toMatchObject({ status: "ok", opened: "no_question" });
      expect(db.transactions).toBe(0);
      expect(posted).toEqual([]);
      expect(warn.mock.calls.some((c: unknown[]) => String(c[0]).includes("unavailable"))).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = saved;
    }
  });

  it("the web daily: null, no round stored", async () => {
    fakeBank.set([]);
    invalidateBank();
    expect(await getDailyRound(NOW)).toBeNull();
    expect(db.writes).toBe(0);
    expect(await practicePool(NOW)).toEqual([]);
  });

  it("an outage never re-points today's stored daily or voids its answers", async () => {
    db.rounds.push({ id: 1, dayKey: TODAY, questionId: "pd-901", surface: "WEB_DAILY" });
    fakeBank.fail = new Error("connection refused");
    invalidateBank();
    expect(await getDailyRound(NOW)).toBeNull();
    expect(db.writes).toBe(0);
    expect(db.rounds[0].questionId).toBe("pd-901");
    expect((await getBank()).available).toBe(false);
  });
});

describe("today's stored daily vs a partial bank (previews share the production database)", () => {
  const stored = (questionId: string) => db.rounds.push({ id: 1, dayKey: TODAY, questionId, surface: "WEB_DAILY" });

  it("the stored question missing from the bank (mid-import): 503, nothing re-pointed or deleted", async () => {
    stored("pd-901");
    fakeBank.rows.delete("pd-901");
    invalidateBank();
    expect(await getDailyRound(NOW)).toBeNull();
    expect(db.writes).toBe(0);
    expect(db.rounds[0].questionId).toBe("pd-901");
    expect(warn.mock.calls.some((c: unknown[]) => String(c[0]).includes("not in the bank"))).toBe(true);
  });

  it("the stored question's row fails the schema: same, nothing deleted", async () => {
    stored("pd-901");
    const r = fakeBank.rows.get("pd-901")!;
    r.data = { ...(r.data as object), answer: "" };
    invalidateBank();
    expect(await getDailyRound(NOW)).toBeNull();
    expect(db.writes).toBe(0);
  });

  it("the stored question exists and was retired: re-pointed, its attempts voided (unchanged behaviour)", async () => {
    stored("pd-901");
    const r = fakeBank.rows.get("pd-901")!;
    const { pool: _pool, ...rest } = r.data as TriviaQuestion;
    void _pool;
    fakeBank.rows.set("pd-901", { ...r, status: "rejected", pool: null, data: { ...rest, status: "rejected" } });
    invalidateBank();
    const round = await getDailyRound(NOW);
    expect(round!.question.id).not.toBe("pd-901");
    expect(round!.roundId).toBe(1);
    expect(vi.mocked(prisma.triviaAttempt.deleteMany)).toHaveBeenCalled();
  });

  it("a pulled (disabled) stored question keeps being served all day", async () => {
    const reports = await import("./reports");
    vi.mocked(reports.getDisabledIds).mockResolvedValue(["pd-901"]);
    try {
      stored("pd-901");
      expect((await getDailyRound(NOW))!.question.id).toBe("pd-901");
      expect(db.writes).toBe(0);
    } finally {
      vi.mocked(reports.getDisabledIds).mockResolvedValue([]);
    }
  });

  it("losing the create race serves the question the other request stored, not our own pick", async () => {
    (prisma.triviaRound.create as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      db.rounds.push({ id: 9, dayKey: TODAY, questionId: "eb-913", surface: "WEB_DAILY" });
      throw Object.assign(new Error("unique"), { code: "P2002" });
    });
    const round = await getDailyRound(NOW);
    expect(round).toMatchObject({ roundId: 9, question: { id: "eb-913" } });
  });
});

describe("a revealed answer marks the question exposed", () => {
  it("a web daily: never during its own day (today's pick must not move), only once a later day's daily is read", async () => {
    const round = await getDailyRound(NOW);
    const id = round!.question.id;
    for (let i = 0; i < 3; i++) await getDailyRound(NOW);
    expect(fakeBank.rows.get(id)!.exposed).toBe(false);
    // the computed pick is the same all day (here: the stored round's read fails, so the computed one is served)
    vi.mocked(prisma.triviaRound.findUnique).mockRejectedValueOnce(new Error("down"));
    expect((await getDailyRound(NOW))!.question.id).toBe(id);

    // the next day: yesterday's round is in the history, so its question is marked before today's pick
    const tomorrow = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    db.recentDaily = [{ questionId: id }];
    const next = await getDailyRound(tomorrow);
    expect(fakeBank.rows.get(id)).toMatchObject({ exposed: true, updatedBy: "system:revealed" });
    expect((await getBank()).exposedIds.has(id)).toBe(true); // the cache was dropped
    expect(next!.question.id).not.toBe(id);
    expect(fakeBank.rows.get(next!.question.id)!.exposed).toBe(false);
  });

  it("a Discord round that expires, or is won", async () => {
    db.dueDiscord = [{ id: 3, questionId: "pd-909", channelId: "1", messageId: "2", rewardPep: 20, openedAt: new Date(NOW.getTime() - 600_000), closesAt: new Date(NOW.getTime() - 1000) }];
    const { deps } = fakePost();
    expect(await expireRounds(NOW, deps)).toBe(1);
    expect(fakeBank.rows.get("pd-909")).toMatchObject({ exposed: true, updatedBy: "system:revealed" });
    await announceWin({ id: 4, channelId: "1", questionId: "eb-924" }, { discordId: "5", messageId: "6", rewardPep: 20, paid: true }, deps);
    expect(fakeBank.rows.get("eb-924")!.exposed).toBe(true);
  });

  it("a failure to mark never breaks the round", async () => {
    db.dueDiscord = [{ id: 3, questionId: "pd-909", channelId: "1", messageId: "2", rewardPep: 20, openedAt: new Date(NOW.getTime() - 600_000), closesAt: new Date(NOW.getTime() - 1000) }];
    await getBank(); // cached
    fakeBank.fail = new Error("write failed");
    const { deps, posted } = fakePost();
    expect(await expireRounds(NOW, deps)).toBe(1);
    expect(posted.length).toBe(1); // the reveal still went out (from the cached bank)
  });
});

describe("practice fails closed when today's daily cannot be read", () => {
  it("the round read fails (the daily falls back to its computed pick with no round id): practice is null / empty", async () => {
    fakeBank.setExposed([...fakeBank.rows.keys()]);
    invalidateBank();
    db.rounds.push({ id: 1, dayKey: TODAY, questionId: "pd-901", surface: "WEB_DAILY" });
    vi.mocked(prisma.triviaRound.findUnique).mockRejectedValue(new Error("down"));
    try {
      expect((await getDailyRound(NOW))!.roundId).toBeNull();
      expect(await practicePoolOrNull(NOW)).toBeNull();
      expect(await practicePool(NOW)).toEqual([]); // so the stored daily pd-901 can never be revealed by practice
    } finally {
      vi.mocked(prisma.triviaRound.findUnique).mockImplementation((async ({ where }: { where: { dayKey: string } }) => db.rounds.find((r) => r.dayKey === where.dayKey) ?? null) as never);
    }
    const pool = await practicePoolOrNull(NOW);
    expect(pool).not.toBeNull();
    expect(pool!.some((q) => q.id === "pd-901")).toBe(false);
  });
});

describe("practice serves exposed questions only", () => {
  it("nothing exposed: nothing to practise; exposed ones (minus today's daily) only", async () => {
    expect(await practicePool(NOW)).toEqual([]);
    fakeBank.setExposed(["pd-901", "pd-903", "eb-904", "pd-909"]); // pd-909 is a Discord question: never on the web
    invalidateBank();
    const pool = await practicePool(NOW);
    const daily = (await getDailyRound(NOW))!.question.id;
    expect(pool.map((q) => q.id).sort()).toEqual(["eb-904", "pd-901", "pd-903"].filter((id) => id !== daily).sort());
  });
});
