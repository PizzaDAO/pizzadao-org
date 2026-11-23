// @vitest-environment node
// The cross (and lock) on a wrong short-answer attempt. Round store mocked; the real-database path is trivia.concurrency.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/app/lib/db");
vi.mock("@/app/lib/sheets/member-repository", () => ({ fetchMemberIdByDiscordId: vi.fn() }));
vi.mock("./rounds", () => ({ findOpenRound: vi.fn(), findLapsedRound: vi.fn(async () => null), expireLapsedRound: vi.fn(async () => true), claimWin: vi.fn(), announceWin: vi.fn(async () => undefined), defaultPostDeps: { post: vi.fn() } }));
vi.mock("@/app/lib/discord-channels", async (importActual) => ({ ...(await importActual<typeof import("@/app/lib/discord-channels")>()), getGuildEmojiIds: vi.fn() }));
vi.mock("@/app/lib/discord-rest", async (importActual) => ({ ...(await importActual<typeof import("@/app/lib/discord-rest")>()), addDiscordReaction: vi.fn(), removeDiscordReaction: vi.fn() }));

import { processAnswer, type AnswerDeps } from "./answer";
import { claimWin, findOpenRound } from "./rounds";
import { markWrongAttempt, resetReactionState } from "./reactions";
import { addDiscordReaction, DiscordPostError } from "@/app/lib/discord-rest";
import { getBank } from "./bank";
import { OUT_OF_TRIES_REACTION, WRONG_ATTEMPT_REACTION } from "./config";
import type { TriviaQuestion } from "./schema";

const NOW = new Date("2026-12-10T15:00:00Z");
const CHAN = "820000000000000001";
const QMSG = "830000000000000000";
const MSG = "830000000000000005";
const USER = "300000000000000000";

const bank = (await getBank()).questions.filter((q) => q.status === "approved");
const shortText = bank.find((q) => q.type === "short_answer" && q.match.kind === "text")!;
const shortNum = bank.find((q) => q.type === "short_answer" && q.match.kind === "number")!;
const tf = bank.find((q) => q.type === "true_false")!;
const mc = bank.find((q) => q.type === "multiple_choice")!;
const wrongText = (q: TriviaQuestion) =>
  q.match.kind === "number"
    ? "7777777"
    : q.match.kind === "boolean"
      ? q.answer === "true" ? "false" : "true"
      : q.type === "multiple_choice"
        ? String.fromCharCode(97 + ((q.choices!.indexOf(q.answer) + 1) % q.choices!.length))
        : "qzqzqz";
const rightText = (q: TriviaQuestion) => (q.type === "true_false" ? q.answer : q.answer);

const round = (q: TriviaQuestion) => ({ id: 7, questionId: q.id, channelId: CHAN, messageId: QMSG, rewardPep: 20, openedAt: new Date(NOW.getTime() - 60_000), closesAt: new Date(NOW.getTime() + 540_000) });

let deferred: Array<() => Promise<void>>;
let markWrong: ReturnType<typeof vi.fn>;
function deps(over: Partial<AnswerDeps> = {}): AnswerDeps {
  return {
    now: () => NOW,
    isMember: vi.fn(async () => true),
    findAttempt: vi.fn(async () => null),
    throttled: vi.fn(async () => false),
    markWrong: markWrong as unknown as AnswerDeps["markWrong"],
    defer: (fn) => void deferred.push(fn),
    post: vi.fn(async () => ({ id: "1" })),
    ...over,
  };
}
const input = (content: string) => ({ channelId: CHAN, messageId: MSG, discordId: USER, content });
const flush = async () => {
  for (const f of deferred) await f();
};

beforeEach(() => {
  deferred = [];
  markWrong = vi.fn(async () => undefined);
  vi.mocked(claimWin).mockReset();
  vi.mocked(findOpenRound).mockReset();
});

describe("a wrong typed short answer gets a cross on the member's own message", () => {
  beforeEach(() => vi.mocked(findOpenRound).mockResolvedValue(round(shortText) as never));

  it("a wrong try that is not the last: a cross only", async () => {
    for (const used of [1, 2]) {
      deferred = [];
      markWrong.mockClear();
      vi.mocked(claimWin).mockResolvedValue({ kind: "wrong", attemptsUsed: used });
      expect(await processAnswer(input(wrongText(shortText)), deps())).toEqual({ status: "wrong" });
      await flush();
      expect(markWrong).toHaveBeenCalledWith(CHAN, MSG, [WRONG_ATTEMPT_REACTION]);
    }
  });

  it("the 3rd wrong try (3 of 3): a cross and a lock, in that order", async () => {
    vi.mocked(claimWin).mockResolvedValue({ kind: "wrong", attemptsUsed: 3 });
    await processAnswer(input(wrongText(shortText)), deps());
    await flush();
    expect(markWrong).toHaveBeenCalledWith(CHAN, MSG, [WRONG_ATTEMPT_REACTION, OUT_OF_TRIES_REACTION]);
  });

  it("a wrong numeric short answer is marked too", async () => {
    vi.mocked(findOpenRound).mockResolvedValue(round(shortNum) as never);
    vi.mocked(claimWin).mockResolvedValue({ kind: "wrong", attemptsUsed: 1 });
    expect((await processAnswer(input(wrongText(shortNum)), deps())).status).toBe("wrong");
    await flush();
    expect(markWrong).toHaveBeenCalledWith(CHAN, MSG, [WRONG_ATTEMPT_REACTION]);
  });

  it("the mark is queued after grading (deferred), not run inside the request", async () => {
    vi.mocked(claimWin).mockResolvedValue({ kind: "wrong", attemptsUsed: 1 });
    await processAnswer(input(wrongText(shortText)), deps());
    expect(markWrong).not.toHaveBeenCalled();
    expect(deferred).toHaveLength(1);
  });

  it("a failing reaction never fails the request (the deferred job is caught by the route; the outcome is unchanged)", async () => {
    markWrong.mockRejectedValue(new Error("Missing Permissions"));
    vi.mocked(claimWin).mockResolvedValue({ kind: "wrong", attemptsUsed: 1 });
    expect(await processAnswer(input(wrongText(shortText)), deps())).toEqual({ status: "wrong" });
  });
});

describe("no mark anywhere else", () => {
  it("true/false and multiple choice stay silent, typed answers too (a public cross would reveal the answer)", async () => {
    for (const q of [tf, mc]) {
      deferred = [];
      vi.mocked(findOpenRound).mockResolvedValue(round(q) as never);
      vi.mocked(claimWin).mockResolvedValue({ kind: "wrong", attemptsUsed: 1 });
      const out = await processAnswer(input(wrongText(q)), deps());
      expect(out).toEqual({ status: "wrong" });
      await flush();
      expect(markWrong).not.toHaveBeenCalled();
    }
  });

  it("everything that is not a graded wrong short answer is unmarked: correct but ineligible, a win, duplicate, late, closed, over the cap", async () => {
    vi.mocked(findOpenRound).mockResolvedValue(round(shortText) as never);
    const results = [
      { kind: "ineligible", reason: "not_member" },
      { kind: "ineligible", reason: "too_young" },
      { kind: "daily_cap" },
      { kind: "won", rewardPep: 20, paid: true },
      { kind: "duplicate", correct: false, won: false },
      { kind: "late" },
      { kind: "closed" },
      { kind: "attempts_exhausted" },
    ] as const;
    for (const r of results) {
      deferred = [];
      vi.mocked(claimWin).mockResolvedValue(r as never);
      await processAnswer(input(rightText(shortText)), deps());
      await flush();
    }
    expect(markWrong).not.toHaveBeenCalled();
  });

  it("a retry of a recorded message (dedupe before grading) is unmarked", async () => {
    vi.mocked(findOpenRound).mockResolvedValue(round(shortText) as never);
    expect(await processAnswer(input(wrongText(shortText)), deps({ findAttempt: vi.fn(async () => ({ correct: false })) }))).toEqual({ status: "duplicate" });
    await flush();
    expect(markWrong).not.toHaveBeenCalled();
    expect(claimWin).not.toHaveBeenCalled();
  });

  it("an attempt after the round closed never reaches grading, so it is unmarked", async () => {
    vi.mocked(findOpenRound).mockResolvedValue(null);
    expect(await processAnswer(input(wrongText(shortText)), deps())).toEqual({ status: "no_round" });
    await flush();
    expect(markWrong).not.toHaveBeenCalled();
  });

  it("ordinary chat the matcher ignores is not an attempt and is never marked (text and number questions)", async () => {
    for (const q of [shortText, shortNum]) {
      vi.mocked(findOpenRound).mockResolvedValue(round(q) as never);
      vi.mocked(claimWin).mockResolvedValue({ kind: "wrong", attemptsUsed: 1 });
      for (const chat of ["hey everyone how is the call going today friends", "does anyone know when the next call starts tonight"]) {
        deferred = [];
        expect(await processAnswer(input(chat), deps())).toEqual({ status: "ignored", why: "not_an_answer" });
        expect(deferred).toHaveLength(0);
      }
    }
    // number questions ignore all chat without a number
    vi.mocked(findOpenRound).mockResolvedValue(round(shortNum) as never);
    for (const chat of ["lol nice", "who wants pizza", "brb", "ok", "thanks!", "\u{1F355}"]) {
      deferred = [];
      expect(await processAnswer(input(chat), deps())).toEqual({ status: "ignored", why: "not_an_answer" });
      expect(deferred).toHaveLength(0);
    }
    // the matcher's "ignore" never calls claimWin, so it can never be marked
    vi.mocked(claimWin).mockClear();
    vi.mocked(findOpenRound).mockResolvedValue(round(shortNum) as never);
    await processAnswer(input("hey everyone how is the call going today friends"), deps());
    expect(claimWin).not.toHaveBeenCalled();
    expect(markWrong).not.toHaveBeenCalled();
  });
});

describe("markWrongAttempt (the Discord side)", () => {
  const add = vi.mocked(addDiscordReaction);
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    resetReactionState();
    add.mockReset();
    add.mockResolvedValue(undefined);
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.DISCORD_BOT_TOKEN = "test-token";
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  const run = async (emojis: string[]) => {
    const p = markWrongAttempt(CHAN, MSG, emojis);
    await vi.runAllTimersAsync();
    await p;
  };

  it("adds the cross then the lock to the member's message, in order", async () => {
    await run([WRONG_ATTEMPT_REACTION, OUT_OF_TRIES_REACTION]);
    expect(add.mock.calls.map((c) => c[0].emoji)).toEqual([WRONG_ATTEMPT_REACTION, OUT_OF_TRIES_REACTION]);
    for (const c of add.mock.calls) expect(c[0]).toMatchObject({ channelId: CHAN, messageId: MSG, botToken: "test-token" });
  });

  it("a refusal never throws, stops there, and is logged once per window", async () => {
    add.mockRejectedValue(new DiscordPostError("Missing Permissions", 403));
    await run([WRONG_ATTEMPT_REACTION, OUT_OF_TRIES_REACTION]);
    await run([WRONG_ATTEMPT_REACTION]);
    await run([WRONG_ATTEMPT_REACTION]);
    expect(add).toHaveBeenCalledTimes(3); // the lock after a failed cross is not attempted
    expect(warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes("mark a wrong attempt"))).toHaveLength(1);
  });
});
