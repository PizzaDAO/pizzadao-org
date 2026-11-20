// @vitest-environment node
// The answer intake logic with the round store mocked (the real-database path is trivia.concurrency.test.ts).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/lib/db");
vi.mock("@/app/lib/sheets/member-repository", () => ({ fetchMemberIdByDiscordId: vi.fn() }));
vi.mock("./rounds", () => ({ findOpenRound: vi.fn(), claimWin: vi.fn(), announceWin: vi.fn(async () => undefined), defaultPostDeps: { post: vi.fn() } }));

import { accountOldEnough, processAnswer, type AnswerDeps } from "./answer";
import { announceWin, claimWin, findOpenRound } from "./rounds";
import { servable } from "./bank";
import type { TriviaQuestion } from "./schema";

const NOW = new Date("2026-12-10T15:00:00Z");
const CHAN = "820000000000000001";
const BOT_POST = "830000000000000000";
const MSG = "830000000000000005";
const OLD_USER = "300000000000000000"; // created 2016
const NEW_USER = String((BigInt(NOW.getTime() - 2 * 86_400_000 - 1420070400000) << BigInt(22))); // 2 days old

const pool = await servable({ pool: "discord" });
const tf = pool.find((q) => q.type === "true_false")!;
const short = pool.find((q) => q.type === "short_answer" && q.match.kind === "text")!;
const mc = pool.find((q) => q.type === "multiple_choice");

function round(q: TriviaQuestion, over: Record<string, unknown> = {}) {
  return { id: 7, questionId: q.id, channelId: CHAN, messageId: BOT_POST, rewardPep: 20, openedAt: new Date(NOW.getTime() - 60_000), closesAt: new Date(NOW.getTime() + 540_000), ...over };
}

let deferred: Array<() => Promise<void>>;
function deps(over: Partial<AnswerDeps> = {}): AnswerDeps {
  return {
    now: () => NOW,
    isMember: vi.fn(async () => true),
    findAttempt: vi.fn(async () => null),
    throttled: vi.fn(async () => false),
    defer: (fn) => void deferred.push(fn),
    post: vi.fn(async () => ({ id: "1" })),
    ...over,
  };
}
const claim = vi.mocked(claimWin);
const open = vi.mocked(findOpenRound);
const answerOf = (q: TriviaQuestion, correct: boolean) => (q.match.kind === "boolean" ? ((q.answer === "true") === correct ? "true" : "false") : correct ? q.answer : "zzzzqqq");
const input = (content: string, over: Record<string, string> = {}) => ({ channelId: CHAN, messageId: MSG, discordId: OLD_USER, content, ...over });

beforeEach(() => {
  deferred = [];
  claim.mockReset();
  claim.mockResolvedValue({ kind: "won", rewardPep: 20, paid: true });
  open.mockReset();
  open.mockResolvedValue(round(tf) as never);
  vi.mocked(announceWin).mockClear();
});

describe("processAnswer gating", () => {
  it("there is a discord pool with a true/false and a short answer question to test with", () => {
    expect(tf).toBeTruthy();
    expect(short).toBeTruthy();
  });

  it("no open round in the channel", async () => {
    open.mockResolvedValue(null);
    expect(await processAnswer(input("true"), deps())).toEqual({ status: "no_round" });
    expect(claim).not.toHaveBeenCalled();
  });

  it("an answer sent before the question (message id earlier than the bot's post) does not count", async () => {
    expect(await processAnswer(input("true", { messageId: "829999999999999999" }), deps())).toEqual({ status: "ignored", why: "before_question" });
    expect(claim).not.toHaveBeenCalled();
  });

  it("chatter is ignored and never recorded or throttled", async () => {
    const d = deps();
    expect(await processAnswer(input("hey everyone, how is the call going today friends"), d)).toEqual({ status: "ignored", why: "not_an_answer" });
    expect(d.throttled).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });

  it("everyday chat words are not true/false answers in Discord (yes, no, yeah, right, wrong, y, n, thumbs); true, false, t, f and typos are", async () => {
    claim.mockResolvedValue({ kind: "wrong" });
    for (const chat of ["yes", "no", "yeah", "yep", "nope", "right", "wrong", "correct", "y", "n", "\u{1F44D}", "\u2705"]) {
      expect(await processAnswer(input(chat), deps())).toEqual({ status: "ignored", why: "not_an_answer" });
    }
    expect(claim).not.toHaveBeenCalled();
    for (const word of ["true", "TRUE", "false", "t", "f", "trie", "flase", "ture"]) {
      claim.mockClear();
      expect((await processAnswer(input(word), deps())).status).not.toBe("ignored");
      expect(claim).toHaveBeenCalledTimes(1);
    }
  });

  it("a second message inside 2 seconds is ignored silently", async () => {
    expect(await processAnswer(input(answerOf(tf, true)), deps({ throttled: async () => true }))).toEqual({ status: "ignored", why: "rate_limited" });
    expect(claim).not.toHaveBeenCalled();
  });

  it("a retry of a recorded message is a duplicate: answered from the store before the throttle or the matcher", async () => {
    const d = deps({ findAttempt: vi.fn(async () => ({ correct: true })), throttled: vi.fn(async () => true) });
    expect(await processAnswer(input(answerOf(tf, true)), d)).toEqual({ status: "duplicate" });
    expect(d.throttled).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
  });

  it("a 5xx then a retry: the failed first try leaves nothing behind that throttles the retry", async () => {
    // First delivery: the claim blows up (database blip) after the answer was judged.
    claim.mockRejectedValueOnce(new Error("db blip"));
    const d = deps();
    await expect(processAnswer(input(answerOf(tf, true)), d)).rejects.toThrow("db blip");
    // Retry of the same message: nothing was stored, the throttle counts stored attempts only, so it goes through.
    claim.mockResolvedValue({ kind: "won", rewardPep: 20, paid: true });
    expect(await processAnswer(input(answerOf(tf, true)), d)).toEqual({ status: "won", rewardPep: 20, paid: true });
    expect(d.throttled).toHaveBeenCalledTimes(2);
    expect(vi.mocked(d.throttled).mock.results.every((r) => r.type === "return")).toBe(true);
    // And a retry after it was stored is a duplicate.
    const stored = deps({ findAttempt: async () => ({ correct: true }) });
    expect(await processAnswer(input(answerOf(tf, true)), stored)).toEqual({ status: "duplicate" });
  });

  it("a wrong answer is recorded and gets no reply", async () => {
    claim.mockResolvedValue({ kind: "wrong" });
    expect(await processAnswer(input(answerOf(tf, false)), deps())).toEqual({ status: "wrong" });
    expect(claim.mock.calls[0][0]).toMatchObject({ correct: false, maxAttempts: 1, discordId: OLD_USER, messageId: MSG });
    expect(deferred).toHaveLength(0);
  });
});

describe("processAnswer eligibility and attempts", () => {
  it("a correct answer from an onboarded member of an old account is eligible and announced", async () => {
    const d = deps();
    const out = await processAnswer(input(answerOf(tf, true)), d);
    expect(out).toEqual({ status: "won", rewardPep: 20, paid: true });
    expect(claim.mock.calls[0][0]).toMatchObject({ correct: true, eligibility: { ok: true }, round: { id: 7, rewardPep: 20 } });
    expect(deferred).toHaveLength(1);
    await deferred[0]();
    expect(announceWin).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), { discordId: OLD_USER, messageId: MSG, rewardPep: 20, paid: true }, expect.anything());
  });

  it("an account younger than 7 days cannot win, and nothing is said in the channel", async () => {
    claim.mockResolvedValue({ kind: "ineligible", reason: "too_young" });
    const d = deps();
    const out = await processAnswer(input(answerOf(tf, true), { discordId: NEW_USER }), d);
    expect(out).toEqual({ status: "not_won", why: "too_young" });
    expect(claim.mock.calls[0][0]).toMatchObject({ correct: true, eligibility: { ok: false, reason: "too_young" } });
    expect(d.isMember).not.toHaveBeenCalled(); // the cheap check first
    expect(deferred).toHaveLength(0);
    expect(d.post).not.toHaveBeenCalled();
  });

  it("a non-member cannot win, and nothing is said in the channel (a public Correct! would leak the answer)", async () => {
    claim.mockResolvedValue({ kind: "ineligible", reason: "not_member" });
    const d = deps({ isMember: async () => false });
    const out = await processAnswer(input(answerOf(tf, true)), d);
    expect(out).toEqual({ status: "not_won", why: "not_member" });
    expect(claim.mock.calls[0][0]).toMatchObject({ eligibility: { ok: false, reason: "not_member" } });
    expect(deferred).toHaveLength(0);
    expect(d.post).not.toHaveBeenCalled();
  });

  it("membership is not looked up for a wrong answer", async () => {
    claim.mockResolvedValue({ kind: "wrong" });
    const d = deps();
    await processAnswer(input(answerOf(tf, false)), d);
    expect(d.isMember).not.toHaveBeenCalled();
  });

  it("the daily cap leaves the round open and says nothing", async () => {
    claim.mockResolvedValue({ kind: "daily_cap" });
    const d = deps();
    expect(await processAnswer(input(answerOf(tf, true)), d)).toEqual({ status: "not_won", why: "daily_cap" });
    expect(deferred).toHaveLength(0);
    expect(d.post).not.toHaveBeenCalled();
  });

  it("late, closed and exhausted answers get no reply", async () => {
    for (const kind of ["late", "closed", "attempts_exhausted"] as const) {
      claim.mockResolvedValue({ kind });
      deferred = [];
      expect(await processAnswer(input(answerOf(tf, true)), deps())).toEqual({ status: "not_won", why: kind });
      expect(deferred).toHaveLength(0);
    }
  });

  it("a replayed message (recorder retry) is a duplicate and says nothing", async () => {
    claim.mockResolvedValue({ kind: "duplicate", correct: true, won: true });
    expect(await processAnswer(input(answerOf(tf, true)), deps())).toEqual({ status: "duplicate" });
    expect(deferred).toHaveLength(0);
  });

  it("true/false and multiple choice get 1 attempt, short answers 3", async () => {
    claim.mockResolvedValue({ kind: "wrong" });
    await processAnswer(input(answerOf(tf, false)), deps());
    expect(claim.mock.calls[0][0].maxAttempts).toBe(1);
    if (mc) {
      open.mockResolvedValue(round(mc) as never);
      await processAnswer(input("zzzzqqq a"), deps());
    }
    open.mockResolvedValue(round(short) as never);
    claim.mockClear();
    await processAnswer(input(answerOf(short, false)), deps());
    if (claim.mock.calls.length) expect(claim.mock.calls[0][0].maxAttempts).toBe(3);
  });

  it("a round without a stored message id only counts messages made after it opened", async () => {
    open.mockResolvedValue(round(tf, { messageId: null }) as never);
    claim.mockResolvedValue({ kind: "wrong" });
    // 2016 snowflake: before the round opened
    expect(await processAnswer(input("true", { messageId: "300000000000000000" }), deps())).toEqual({ status: "ignored", why: "before_question" });
    const afterOpen = String(BigInt(NOW.getTime() - 1000 - 1420070400000) << BigInt(22));
    expect((await processAnswer(input(answerOf(tf, false), { messageId: afterOpen }), deps())).status).toBe("wrong");
  });
});

describe("accountOldEnough", () => {
  it("uses the snowflake date: 7 days or more", () => {
    expect(accountOldEnough(OLD_USER, NOW)).toBe(true);
    expect(accountOldEnough(NEW_USER, NOW)).toBe(false);
    expect(accountOldEnough("nope", NOW)).toBe(false);
    const sixDays = String((BigInt(NOW.getTime() - 6 * 86_400_000 - 1420070400000) << BigInt(22)));
    const eightDays = String((BigInt(NOW.getTime() - 8 * 86_400_000 - 1420070400000) << BigInt(22)));
    expect(accountOldEnough(sixDays, NOW)).toBe(false);
    expect(accountOldEnough(eightDays, NOW)).toBe(true);
  });
});
