// @vitest-environment node
/**
 * The trivia APIs: answer secrecy (no answer/aliases/rejects before an attempt), the practice and daily verdicts,
 * the web/Discord pool split, rate limits and report validation. The database is an in-memory fake; the rate
 * limiter is the real one (in-memory fallback, since no Upstash env is set in tests).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const session = vi.hoisted(() => ({ value: null as null | { discordId: string } }));
const db = vi.hoisted(() => ({
  rounds: [] as { id: number; dayKey: string | null; questionId: string; surface: string }[],
  attempts: [] as { roundId: number; discordId: string; messageId: string | null; correct: boolean; answerText: string }[],
  reports: [] as { questionId: string; discordId: string | null; text: string }[],
  down: false,
}));

// The reward is mocked at its two entry points: its own logic is tested in web-reward.test.ts and the real-Postgres suite.
const reward = vi.hoisted(() => ({ configured: false, paid: false, offer: 0, status: "paid" as string, calls: 0 }));
vi.mock("@/app/lib/trivia/web", async (importActual) => ({
  ...(await importActual<typeof import("@/app/lib/trivia/web")>()),
  dailyRewardOffer: async () => reward.offer,
  dailyRewardConfigured: async () => reward.configured,
  dailyRewardPaid: async () => reward.paid,
  payDailyReward: async () => {
    reward.calls++;
    return { pep: reward.offer, status: reward.status };
  },
}));
vi.mock("@/app/lib/session", () => ({ getSession: async () => session.value }));
// Signed-in reports go through recordReport (eligibility, dedupe, auto-pull): its own tests are in reports.test.ts and the
// real-database suite; here it just records what the route handed it.
const recorded = vi.hoisted(() => ({ calls: [] as { questionId: string; discordId: string; text: string }[] }));
vi.mock("@/app/lib/trivia/reports", async (importActual) => ({
  ...(await importActual<typeof import("@/app/lib/trivia/reports")>()),
  recordReport: vi.fn(async (i: { questionId: string; discordId: string; text: string }) => {
    recorded.calls.push({ questionId: i.questionId, discordId: i.discordId, text: i.text });
    return { status: "recorded", pulled: false, eligible: true };
  }),
}));
vi.mock("@/app/lib/db", () => ({
  prisma: {
    triviaRound: {
      findUnique: async ({ where }: { where: { dayKey: string } }) => {
        if (db.down) throw new Error("relation does not exist");
        return db.rounds.find((r) => r.dayKey === where.dayKey) ?? null;
      },
      update: async ({ where, data }: { where: { id: number }; data: { questionId: string } }) => {
        const row = db.rounds.find((r) => r.id === where.id)!;
        row.questionId = data.questionId;
        return row;
      },
      create: async ({ data }: { data: { dayKey: string; questionId: string; surface: string } }) => {
        if (db.down) throw new Error("relation does not exist");
        const row = { id: db.rounds.length + 1, ...data };
        db.rounds.push(row);
        return row;
      },
    },
    triviaAttempt: {
      findFirst: async ({ where }: { where: { roundId: number; discordId: string } }) =>
        db.attempts.find((a) => a.roundId === where.roundId && a.discordId === where.discordId && a.messageId === null) ?? null,
      create: async ({ data }: { data: (typeof db.attempts)[number] }) => {
        if (db.attempts.some((a) => a.roundId === data.roundId && a.discordId === data.discordId && a.messageId === null)) throw new Error("unique");
        db.attempts.push(data);
        return data;
      },
      count: async ({ where }: { where: { roundId: number; correct?: boolean } }) =>
        db.attempts.filter((a) => a.roundId === where.roundId && (where.correct === undefined || a.correct === where.correct)).length,
      findMany: async () => [],
      deleteMany: async ({ where }: { where: { roundId: number } }) => {
        const before = db.attempts.length;
        db.attempts = db.attempts.filter((a) => a.roundId !== where.roundId);
        return { count: before - db.attempts.length };
      },
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    triviaReport: {
      create: async ({ data }: { data: (typeof db.reports)[number] }) => {
        db.reports.push(data);
        return data;
      },
    },
  },
}));

import { GET as dailyGET, POST as dailyPOST } from "./daily/route";
import { GET as practiceGET, POST as practicePOST } from "./practice/route";
import { POST as reportPOST } from "./report/route";
import { getBank, invalidateBank, servable } from "@/app/lib/trivia/bank";
import { fakeBank } from "@/app/lib/trivia/__fixtures__/fake-bank-store";
import type { TriviaQuestion } from "@/app/lib/trivia/schema";
import { dailyQuestionFor, dayKeyUtc } from "@/app/lib/trivia/daily";

let ipCounter = 0;
const freshIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

function req(url: string, init: { method?: string; body?: unknown; ip?: string } = {}) {
  return new NextRequest(`https://pizzadao.test${url}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", "x-forwarded-for": init.ip ?? freshIp() },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const FORBIDDEN_KEYS = ["answer", "aliases", "rejects", "explanation", "sources", "match", "notes", "pool", "status"];
function keysDeep(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keysDeep(x, out);
    }
  return out;
}

/** A clearly wrong but well-formed answer for any kind of question. */
function wrongFor(q: TriviaQuestion): string {
  if (q.match.kind === "boolean") return q.answer === "true" ? "false" : "true";
  if (q.match.kind === "number") return String(Number(q.answer) + 7);
  if (q.match.kind === "choice") return q.choices!.find((c) => c !== q.answer)!;
  return "zzzz nothing";
}

// The (fixture) pools, read once: no test here changes the bank except the empty-bank ones, which restore it.
const WEB = await servable({ pool: "web" });
const DISCORD = await servable({ pool: "discord" });
const webPool = () => WEB;
/** The body a client sends for today's daily. */
const dailyBody = (answer: string, over: Record<string, unknown> = {}) => {
  const q = dailyQuestionFor(dayKeyUtc(), WEB)!;
  return { answer, dayKey: dayKeyUtc(), questionId: q.id, ...over };
};
const discordPool = () => DISCORD;

beforeEach(() => {
  // Every fixture question exposed (as after the import of the old public bank): practice serves exposed questions only,
  // and with all of them exposed the daily is the plain hash pick (and serving it as the daily changes nothing).
  fakeBank.reset();
  fakeBank.setExposed([...fakeBank.rows.keys()]);
  invalidateBank();
  session.value = null;
  db.rounds.length = 0;
  db.attempts = [];
  db.reports.length = 0;
  db.down = false;
  reward.configured = false;
  reward.paid = false;
  reward.offer = 0;
  reward.status = "paid";
  reward.calls = 0;
});

describe("practice", () => {
  it("GET returns at most 10 public questions with no answer fields, only from the web pool", async () => {
    const res = await practiceGET(req("/api/trivia/practice"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.questions.length).toBe(10);
    const keys = keysDeep(body.questions);
    for (const f of FORBIDDEN_KEYS) expect(keys.has(f), `leaked ${f}`).toBe(false);
    const web = new Set(webPool().map((q) => q.id));
    for (const q of body.questions) expect(web.has(q.id)).toBe(true);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("GET filters by category and rejects an unknown one", async () => {
    const ok = await (await practiceGET(req("/api/trivia/practice?category=early-bitcoin"))).json();
    expect(ok.questions.length).toBeGreaterThan(0);
    expect(ok.questions.every((q: { category: string }) => q.category === "early-bitcoin")).toBe(true);
    expect((await practiceGET(req("/api/trivia/practice?category=nope"))).status).toBe(400);
  });

  it("never serves today's daily question: not in GET, and POST gives 404 (no answer lookup before a recorded attempt)", async () => {
    const daily = dailyQuestionFor(dayKeyUtc(), WEB)!;
    for (let i = 0; i < 40; i++) {
      const body = await (await practiceGET(req("/api/trivia/practice"))).json();
      expect(body.questions.some((q: { id: string }) => q.id === daily.id)).toBe(false);
    }
    const res = await practicePOST(req("/api/trivia/practice", { method: "POST", body: { questionId: daily.id, answer: daily.answer } }));
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain(daily.explanation.slice(0, 20));
  });

  it("fails closed with the tables down: today's daily is unknown, so nothing is served or checked", async () => {
    db.down = true;
    const res = await practiceGET(req("/api/trivia/practice"));
    expect(res.status).toBe(200);
    expect((await res.json()).questions).toEqual([]);
    const q = WEB.find((x) => x.id !== dailyQuestionFor(dayKeyUtc(), WEB)!.id)!;
    const post = await practicePOST(req("/api/trivia/practice", { method: "POST", body: { questionId: q.id, answer: q.answer } }));
    expect(post.status).toBe(503);
    expect(JSON.stringify(await post.json())).not.toContain("reveal");
  });

  it("never serves a Discord-pool question, even across many draws", async () => {
    const discord = new Set(discordPool().map((q) => q.id));
    for (let i = 0; i < 30; i++) {
      const body = await (await practiceGET(req("/api/trivia/practice"))).json();
      for (const q of body.questions) expect(discord.has(q.id)).toBe(false);
    }
  });

  it("POST: correct and wrong verdicts return the reveal (answer, explanation, sources), never aliases or rejects", async () => {
    const dailyId = dailyQuestionFor(dayKeyUtc(), webPool())!.id;
    const q = webPool().find((x) => x.id !== dailyId && x.match.kind === "number")!;
    const right = await practicePOST(req("/api/trivia/practice", { method: "POST", body: { questionId: q.id, answer: q.answer } }));
    const rb = await right.json();
    expect(rb.verdict).toBe("correct");
    expect(rb.reveal.answer).toBeTruthy();
    expect(rb.reveal.sources.length).toBeGreaterThan(0);
    for (const f of ["aliases", "rejects", "notes"]) expect(keysDeep(rb).has(f)).toBe(false);

    const wrong = await practicePOST(req("/api/trivia/practice", { method: "POST", body: { questionId: q.id, answer: "7" } }));
    expect((await wrong.json()).verdict).toBe("wrong");
  });

  it("POST: not an answer is ignored without revealing anything", async () => {
    const dailyId = dailyQuestionFor(dayKeyUtc(), webPool())!.id;
    const tf = webPool().find((x) => x.id !== dailyId && x.type === "true_false")!;
    const body = await (await practicePOST(req("/api/trivia/practice", { method: "POST", body: { questionId: tf.id, answer: "lol what" } }))).json();
    expect(body).toEqual({ verdict: "ignore" });
  });

  it("POST: refuses a Discord-pool, held-back or unknown question (404), and bad bodies (400)", async () => {
    for (const id of [discordPool()[0].id, "pz-908", "eb-935", "bt-900", "nope-999"]) {
      const res = await practicePOST(req("/api/trivia/practice", { method: "POST", body: { questionId: id, answer: "x" } }));
      expect(res.status, id).toBe(404);
    }
    expect((await practicePOST(req("/api/trivia/practice", { method: "POST", body: { questionId: "pd-001" } }))).status).toBe(400);
    expect((await practicePOST(req("/api/trivia/practice", { method: "POST", body: { questionId: "pd-001", answer: "x".repeat(500) } }))).status).toBe(400);
  });

  it("POST: the 31st check in a minute from one IP is 429", async () => {
    const ip = freshIp();
    const dailyId = dailyQuestionFor(dayKeyUtc(), webPool())!.id;
    const q = webPool().find((x) => x.id !== dailyId)!;
    let last = 0;
    for (let i = 0; i < 31; i++) {
      last = (await practicePOST(req("/api/trivia/practice", { method: "POST", ip, body: { questionId: q.id, answer: "x" } }))).status;
      if (i < 30) expect(last).toBe(200);
    }
    expect(last).toBe(429);
  });

  it("POST: a cross-origin write is rejected", async () => {
    const r = new NextRequest("https://pizzadao.test/api/trivia/practice", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example", "x-forwarded-for": freshIp() },
      body: JSON.stringify({ questionId: "pd-001", answer: "x" }),
    });
    expect((await practicePOST(r)).status).toBe(403);
  });
});

describe("daily", () => {
  const today = () => dailyQuestionFor(dayKeyUtc(), webPool())!;

  it("GET returns today's public question, from the web pool, with no answer fields", async () => {
    const res = await dailyGET(req("/api/trivia/daily"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.question.id).toBe(today().id);
    for (const f of FORBIDDEN_KEYS) expect(keysDeep(body).has(f), `leaked ${f}`).toBe(false);
    expect(body.attempt).toBeNull();
    expect(body.signedIn).toBe(false);
    expect(discordPool().some((q) => q.id === body.question.id)).toBe(false);
  });

  it("GET still works when the Trivia tables are missing", async () => {
    db.down = true;
    const res = await dailyGET(req("/api/trivia/daily"));
    expect(res.status).toBe(200);
    expect((await res.json()).question.id).toBe(today().id);
  });

  it("logged out: POST gives only correct/wrong, no answer text, and records nothing", async () => {
    const q = today();
    const res = await dailyPOST(req("/api/trivia/daily", { method: "POST", body: dailyBody(q.answer) }));
    const body = await res.json();
    expect(body.verdict).toBe("correct");
    expect(body.recorded).toBe(false);
    expect(body.signInToReveal).toBe(true);
    for (const f of ["reveal", "explanation", "sources", "answer"]) expect(keysDeep(body).has(f), `leaked ${f}`).toBe(false);
    expect(db.attempts).toHaveLength(0);
    const wrong = await (await dailyPOST(req("/api/trivia/daily", { method: "POST", body: dailyBody(wrongFor(q)) }))).json();
    expect(wrong.verdict).toBe("wrong");
    expect(keysDeep(wrong).has("reveal")).toBe(false);
  });

  it("logged out while a reward is on offer: no verdict at all (no oracle), only a sign-in prompt", async () => {
    reward.configured = true;
    reward.offer = 5;
    const q = today();
    for (const a of [q.answer, wrongFor(q)]) {
      const body = await (await dailyPOST(req("/api/trivia/daily", { method: "POST", body: dailyBody(a) }))).json();
      expect(body.signInToAnswer).toBe(true);
      expect(body.verdict).toBeUndefined();
      expect(keysDeep(body).has("reveal")).toBe(false);
    }
    expect(db.attempts).toHaveLength(0);
  });

  it("signed in, correct: the reward comes back; a retry after a failed payout pays again via the already-answered path", async () => {
    session.value = { discordId: "111" };
    reward.offer = 5;
    reward.status = "error";
    const q = today();
    const first = await (await dailyPOST(req("/api/trivia/daily", { method: "POST", body: dailyBody(q.answer) }))).json();
    expect(first.reward).toEqual({ pep: 5, status: "error" });
    reward.status = "paid";
    const second = await (await dailyPOST(req("/api/trivia/daily", { method: "POST", body: dailyBody(q.answer) }))).json();
    expect(second.alreadyAnswered).toBe(true);
    expect(second.reward).toEqual({ pep: 5, status: "paid" });
    expect(reward.calls).toBe(2);
  });

  it("a preview (reward configured but not live, offer 0): logged out still gets no verdict", async () => {
    reward.configured = true;
    reward.offer = 0;
    const q = today();
    const body = await (await dailyPOST(req("/api/trivia/daily", { method: "POST", body: dailyBody(q.answer) }))).json();
    expect(body.signInToAnswer).toBe(true);
    expect(body.verdict).toBeUndefined();
  });

  it("GET retries a failed payout once for a correct attempt, and does not call the payout when already paid", async () => {
    session.value = { discordId: "113" };
    reward.offer = 5;
    reward.status = "error";
    const q = today();
    await dailyPOST(req("/api/trivia/daily", { method: "POST", body: dailyBody(q.answer) }));
    expect(reward.calls).toBe(1);
    reward.status = "paid";
    const g = await (await dailyGET(req("/api/trivia/daily"))).json();
    expect(g.reward).toEqual({ pep: 5, status: "paid" });
    expect(reward.calls).toBe(2);
    reward.paid = true; // the reward row now exists
    const g2 = await (await dailyGET(req("/api/trivia/daily"))).json();
    expect(g2.reward).toBeUndefined();
    expect(reward.calls).toBe(2);
  });

  it("signed in, wrong: no payout is attempted", async () => {
    session.value = { discordId: "112" };
    reward.offer = 5;
    const q = today();
    const body = await (await dailyPOST(req("/api/trivia/daily", { method: "POST", body: dailyBody(wrongFor(q)) }))).json();
    expect(body.reward).toBeUndefined();
    expect(reward.calls).toBe(0);
  });

  it("signed in: one recorded attempt per day; a second submit returns the first result, and GET then reveals", async () => {
    session.value = { discordId: "111" };
    const q = today();
    const first = await (await dailyPOST(req("/api/trivia/daily", { method: "POST", body: dailyBody(wrongFor(q)) }))).json();
    expect(first.verdict).toBe("wrong");
    expect(first.recorded).toBe(true);
    expect(first.reveal.answer).toBeTruthy();
    expect(db.attempts).toHaveLength(1);

    const second = await (await dailyPOST(req("/api/trivia/daily", { method: "POST", body: dailyBody(q.answer) }))).json();
    expect(second.alreadyAnswered).toBe(true);
    expect(second.verdict).toBe("wrong"); // the first attempt stands
    expect(db.attempts).toHaveLength(1);

    const got = await (await dailyGET(req("/api/trivia/daily"))).json();
    expect(got.signedIn).toBe(true);
    expect(got.attempt.correct).toBe(false);
    expect(got.attempt.reveal.answer).toBeTruthy();
  });

  it("a stale dayKey or questionId (UTC midnight, or a pulled question) is a 409: nothing graded, nothing recorded", async () => {
    session.value = { discordId: "555" };
    const q = today();
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    for (const over of [{ dayKey: yesterday }, { questionId: "pd-001-nope" }]) {
      const res = await dailyPOST(req("/api/trivia/daily", { method: "POST", body: dailyBody(q.answer, over) }));
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.code).toBe("STALE_QUESTION");
      expect(keysDeep(body).has("verdict")).toBe(false);
    }
    expect(db.attempts).toHaveLength(0);
  });

  it("a body without dayKey and questionId is a 400", async () => {
    const res = await dailyPOST(req("/api/trivia/daily", { method: "POST", body: { answer: "x" } }));
    expect(res.status).toBe(400);
  });

  it("not an answer does not use the day's attempt", async () => {
    session.value = { discordId: "222" };
    const q = today();
    if (q.match.kind !== "boolean") return; // only a true/false question treats chit-chat as ignore
    const body = await (await dailyPOST(req("/api/trivia/daily", { method: "POST", body: dailyBody("hmm not sure") }))).json();
    expect(body.verdict).toBe("ignore");
    expect(db.attempts).toHaveLength(0);
  });

  it("tables down: a signed-in member gets the verdict but no answer text (nothing recorded)", async () => {
    db.down = true;
    session.value = { discordId: "333" };
    const q = today();
    const body = await (await dailyPOST(req("/api/trivia/daily", { method: "POST", body: dailyBody(q.answer) }))).json();
    expect(body.verdict).toBe("correct");
    expect(body.recorded).toBe(false);
    expect(keysDeep(body).has("reveal")).toBe(false);
  });

  it("a question pulled mid-day: the round is re-pointed at the replacement and the old answers are voided", async () => {
    const pulled = DISCORD[0]; // not in the web pool, like a disabled question
    db.rounds.push({ id: 1, dayKey: dayKeyUtc(), questionId: pulled.id, surface: "WEB_DAILY" });
    db.attempts.push({ roundId: 1, discordId: "777", messageId: null, correct: true, answerText: "x" });
    const body = await (await dailyGET(req("/api/trivia/daily"))).json();
    expect(body.question.id).toBe(today().id);
    expect(db.rounds[0].questionId).toBe(today().id);
    expect(db.attempts).toHaveLength(0); // graded against the pulled question: void, so reveal and % stay consistent
    expect(body.attempt).toBeNull();
  });
});

describe("report", () => {
  const post = (body: unknown, ip?: string) => reportPOST(req("/api/trivia/report", { method: "POST", body, ip }));

  it("a signed-in member's report goes through recordReport (eligibility, dedupe, auto-pull), with their Discord id", async () => {
    session.value = { discordId: "444" };
    recorded.calls.length = 0;
    const q = webPool()[0];
    const res = await post({ questionId: q.id, text: "  The date looks wrong  " });
    expect(res.status).toBe(200);
    expect(recorded.calls).toEqual([{ questionId: q.id, discordId: "444", text: "The date looks wrong" }]);
    expect(db.reports).toHaveLength(0); // the route no longer writes the row itself for members
  });

  it("a logged-out report is stored anonymously and can never count toward an auto-pull", async () => {
    session.value = null;
    recorded.calls.length = 0;
    const q = webPool()[0];
    expect((await post({ questionId: q.id, text: "The date looks wrong" })).status).toBe(200);
    expect(db.reports).toEqual([{ questionId: q.id, discordId: null, text: "The date looks wrong" }]);
    expect(recorded.calls).toHaveLength(0);
  });

  it("rejects short or long text, unknown, Discord-pool and held-back questions", async () => {
    const q = webPool()[0];
    expect((await post({ questionId: q.id, text: "x" })).status).toBe(400);
    expect((await post({ questionId: q.id, text: "y".repeat(501) })).status).toBe(400);
    expect((await post({ questionId: "nope-1", text: "something is off" })).status).toBe(404);
    expect((await post({ questionId: discordPool()[0].id, text: "something is off" })).status).toBe(404);
    expect((await post({ questionId: "pz-908", text: "something is off" })).status).toBe(404);
    expect(db.reports).toHaveLength(0);
  });

  it("is rate limited per IP (5 per 10 minutes)", async () => {
    const ip = freshIp();
    const q = webPool()[0];
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await post({ questionId: q.id, text: "something is off" }, ip)).status);
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
  });
});

describe("practice is not an oracle for future dailies", () => {
  it("an unexposed web question is never served or checked by practice (its answer is not public)", async () => {
    const fresh = WEB.filter((q) => q.id !== dailyQuestionFor(dayKeyUtc(), WEB)!.id).slice(0, 3);
    fakeBank.setExposed(fresh.map((q) => q.id), false);
    invalidateBank();
    const body = await (await practiceGET(req("/api/trivia/practice"))).json();
    for (const q of fresh) expect(body.questions.some((x: { id: string }) => x.id === q.id)).toBe(false);
    for (const q of fresh) {
      const res = await practicePOST(req("/api/trivia/practice", { method: "POST", body: { questionId: q.id, answer: q.answer } }));
      expect(res.status).toBe(404);
      expect(JSON.stringify(await res.json())).not.toContain("reveal");
    }
  });

  it("with nothing exposed, practice has nothing to serve", async () => {
    fakeBank.setExposed([...fakeBank.rows.keys()], false);
    invalidateBank();
    const body = await (await practiceGET(req("/api/trivia/practice"))).json();
    expect(body.questions).toEqual([]);
  });
});

describe("an empty or unreachable bank", () => {
  afterEach(() => {
    fakeBank.reset();
    invalidateBank();
  });

  it("the daily is a 503 (nothing stored), practice is empty, a report is a 404: nothing crashes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fakeBank.set([]);
    invalidateBank();
    expect((await dailyGET(req("/api/trivia/daily"))).status).toBe(503);
    session.value = { discordId: "100000000000000001" };
    expect((await dailyPOST(req("/api/trivia/daily", { method: "POST", body: { answer: "x", dayKey: dayKeyUtc(), questionId: "pd-901" } }))).status).toBe(503);
    expect(db.rounds).toEqual([]);
    expect(reward.calls).toBe(0);
    const practice = await (await practiceGET(req("/api/trivia/practice"))).json();
    expect(practice.questions).toEqual([]);
    expect((await practicePOST(req("/api/trivia/practice", { method: "POST", body: { questionId: "pd-901", answer: "10000" } }))).status).toBe(503); // no daily: practice is closed
    expect((await reportPOST(req("/api/trivia/report", { method: "POST", body: { questionId: "pd-901", text: "something is off" } }))).status).toBe(404);
    warn.mockRestore();
  });

  it("an outage is the same, logged", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeBank.fail = new Error("connection refused");
    invalidateBank();
    expect((await dailyGET(req("/api/trivia/daily"))).status).toBe(503);
    expect((await (await practiceGET(req("/api/trivia/practice"))).json()).questions).toEqual([]);
    expect(err.mock.calls.some((c) => String(c[0]).includes("question bank unavailable"))).toBe(true);
    err.mockRestore();
  });
});

describe("no public response carries an answer, whatever the question", () => {
  it("daily GET (signed out and in, before an attempt) and practice GET, for every web question as the daily", async () => {
    // Make each web question the only one in turn, so every question is served as the daily once.
    try {
      for (const q of WEB) {
        fakeBank.reset();
        for (const id of [...fakeBank.rows.keys()]) if (id !== q.id) fakeBank.rows.delete(id);
        invalidateBank();
        db.rounds.length = 0;
        for (const signedIn of [false, true]) {
          session.value = signedIn ? { discordId: "100000000000000002" } : null;
          const body = await (await dailyGET(req("/api/trivia/daily"))).json();
          expect(body.question.id).toBe(q.id);
          for (const f of FORBIDDEN_KEYS) expect(keysDeep(body).has(f), `${q.id} leaked ${f}`).toBe(false);
          // (a multiple-choice answer is one of its choices, which are part of the question)
          if (q.type !== "multiple_choice" && q.answer.length > 3) expect(JSON.stringify(body).toLowerCase()).not.toContain(`"${q.answer.toLowerCase()}"`);
        }
      }
    } finally {
      fakeBank.reset();
      invalidateBank();
    }
    const practice = await (await practiceGET(req("/api/trivia/practice"))).json();
    for (const f of FORBIDDEN_KEYS) expect(keysDeep(practice).has(f), `practice leaked ${f}`).toBe(false);
  });
});

describe("bank pool sanity for the routes", () => {
  it("has questions in both pools", async () => {
    expect((await getBank()).questions.length).toBeGreaterThan(20);
    expect(webPool().length).toBeGreaterThan(11);
    expect(discordPool().length).toBeGreaterThan(5);
  });
});
