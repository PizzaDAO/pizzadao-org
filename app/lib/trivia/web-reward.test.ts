// @vitest-environment node
// The web daily reward (trivia.webDailyRewardPep): pays once, only the right people, never on dry run or when off.
// The database is a small fake whose attempt claim is atomic like the real conditional UPDATE; the real-Postgres
// concurrency proof is in trivia.concurrency.test.ts.
import { beforeEach, describe, expect, it, vi } from "vitest";

const st = vi.hoisted(() => ({
  settings: { rewardPep: 20, webDailyRewardPep: 5, dryRun: false, roundsPerDay: 3 },
  live: true,
  member: true,
  attempts: [] as { roundId: number; discordId: string; messageId: string | null; correct: boolean }[],
  rewards: [] as { discordId: string; dayKey: string }[],
  credits: [] as { userId: string; amount: number; type: string }[],
  locks: [] as unknown[],
  failCredit: false,
}));

vi.mock("./channel", () => ({ triviaSettings: async () => st.settings }));
vi.mock("./enabled", () => ({ triviaLive: async () => st.live }));
vi.mock("@/app/lib/sheets/member-repository", () => ({ fetchMemberIdByDiscordId: async () => (st.member ? "m1" : null) }));
vi.mock("@/app/lib/economy", () => ({
  getOrCreateEconomy: async () => ({}),
  creditInTx: async (_tx: unknown, userId: string, amount: number, type: string) => {
    if (st.failCredit) throw new Error("db down");
    st.credits.push({ userId, amount, type });
  },
}));
vi.mock("@/app/lib/db", () => {
  const tx = {
    $executeRaw: async (...args: unknown[]) => void st.locks.push(args),
    triviaAttempt: {
      findFirst: async ({ where }: { where: { roundId: number; discordId: string } }) =>
        st.attempts.find((x) => x.roundId === where.roundId && x.discordId === where.discordId && x.messageId === null && x.correct) ?? null,
    },
    triviaDailyReward: {
      createMany: async ({ data }: { data: { discordId: string; dayKey: string }[] }) => {
        const d = data[0];
        if (st.rewards.some((r) => r.discordId === d.discordId && r.dayKey === d.dayKey)) return { count: 0 };
        st.rewards.push(d);
        return { count: 1 };
      },
    },
  };
  return { prisma: { $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } };
});

import { dailyRewardOffer, DAILY_REWARD_LOCK_NAMESPACE, payDailyReward } from "./web";

const OLD = "123456789012345678"; // a 2016 account
const NOW = new Date("2026-11-20T12:00:00Z");
const youngId = String((BigInt(NOW.getTime() - 1420070400000 - 60_000) << BigInt(22)) + BigInt(1)); // created a minute ago

function attempt(discordId: string, correct = true) {
  st.attempts.push({ roundId: 1, discordId, messageId: null, correct });
}
const pay = (discordId: string) => payDailyReward({ roundId: 1, dayKey: "2026-11-20", discordId }, NOW, {});

beforeEach(() => {
  st.settings = { rewardPep: 20, webDailyRewardPep: 5, dryRun: false, roundsPerDay: 3 };
  st.live = true;
  st.member = true;
  st.attempts = [];
  st.credits = [];
  st.rewards = [];
  st.locks = [];
  st.failCredit = false;
});

describe("payDailyReward", () => {
  it("pays a correct attempt once, as TRIVIA_DAILY_REWARD, under the advisory lock", async () => {
    attempt(OLD);
    expect(await pay(OLD)).toEqual({ pep: 5, status: "paid" });
    expect(st.credits).toEqual([{ userId: OLD, amount: 5, type: "TRIVIA_DAILY_REWARD" }]);
    expect(st.locks.length).toBe(1);
    expect(DAILY_REWARD_LOCK_NAMESPACE).toBe(742019347);
    expect(await pay(OLD)).toEqual({ pep: 5, status: "already" });
    expect(st.credits.length).toBe(1);
  });

  it("concurrent correct submissions pay once", async () => {
    attempt(OLD);
    const results = await Promise.all(Array.from({ length: 20 }, () => pay(OLD)));
    expect(results.filter((r) => r.status === "paid").length).toBe(1);
    expect(results.filter((r) => r.status === "already").length).toBe(19);
    expect(st.credits.length).toBe(1);
  });

  it("pays nothing for a wrong attempt (no correct attempt row to claim)", async () => {
    attempt(OLD, false);
    expect((await pay(OLD)).status).toBe("already");
    expect(st.credits.length).toBe(0);
    expect(st.rewards.length).toBe(0);
  });

  it("ineligible: not an onboarded member, or an account under 7 days old", async () => {
    attempt(OLD);
    st.member = false;
    expect(await pay(OLD)).toEqual({ pep: 5, status: "ineligible", reason: "not_member" });
    st.member = true;
    attempt(youngId);
    expect(await pay(youngId)).toEqual({ pep: 5, status: "ineligible", reason: "too_young" });
    expect(st.credits.length).toBe(0);
    expect(st.rewards.length).toBe(0);
  });

  it("setting 0, trivia not live: off, nothing paid", async () => {
    attempt(OLD);
    st.settings.webDailyRewardPep = 0;
    expect((await pay(OLD)).status).toBe("off");
    st.settings.webDailyRewardPep = 5;
    st.live = false;
    expect((await pay(OLD)).status).toBe("off");
    expect(st.credits.length).toBe(0);
  });

  it("dry run pays nothing and logs", async () => {
    attempt(OLD);
    st.settings.dryRun = true;
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    expect((await pay(OLD)).status).toBe("off");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("dry run"));
    expect(st.credits.length).toBe(0);
    log.mockRestore();
  });

  it("a payout failure is swallowed and reported as error", async () => {
    attempt(OLD);
    st.failCredit = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(pay(OLD)).resolves.toEqual({ pep: 0, status: "error" });
    err.mockRestore();
  });

  it("a re-pointed daily (attempt rows deleted, member answers again) never pays twice", async () => {
    attempt(OLD);
    expect((await pay(OLD)).status).toBe("paid");
    st.attempts = []; // getDailyRound voids the attempts when the stored question stops being servable
    attempt(OLD); // the member answers the replacement correctly
    expect((await pay(OLD)).status).toBe("already");
    expect(st.credits.length).toBe(1);
    expect(st.rewards.length).toBe(1);
  });

  it("does not touch the Discord daily cap (it only reads attempts and the ledger, never TriviaRound wins)", async () => {
    attempt(OLD);
    await pay(OLD);
    // The fake tx has no triviaRound at all: paying would throw if it queried or updated Discord round wins.
    expect(st.credits.length).toBe(1);
  });
});

describe("dailyRewardOffer", () => {
  it("is the setting while live, 0 when off, dry run or not live", async () => {
    expect(await dailyRewardOffer({})).toBe(5);
    st.settings.dryRun = true;
    expect(await dailyRewardOffer({})).toBe(0);
    st.settings.dryRun = false;
    st.settings.webDailyRewardPep = 0;
    expect(await dailyRewardOffer({})).toBe(0);
    st.settings.webDailyRewardPep = 5;
    st.live = false;
    expect(await dailyRewardOffer({})).toBe(0);
  });
});
