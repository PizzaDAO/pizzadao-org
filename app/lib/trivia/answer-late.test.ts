// @vitest-environment node
// A member answers after the round's closing time while the round is still OPEN in the database (the cron expires it
// only every few minutes): the round is expired right away, and a correct answer is told it was too late.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/lib/db");
vi.mock("@/app/lib/sheets/member-repository", () => ({ fetchMemberIdByDiscordId: vi.fn() }));
vi.mock("./rounds", () => ({
  findOpenRound: vi.fn(),
  findLapsedRound: vi.fn(),
  expireLapsedRound: vi.fn(async () => true),
  claimWin: vi.fn(),
  announceWin: vi.fn(async () => undefined),
  defaultPostDeps: { post: vi.fn() },
}));

import { processAnswer, processReaction, type AnswerDeps } from "./answer";
import { claimWin, expireLapsedRound, findLapsedRound, findOpenRound } from "./rounds";
import { servable } from "./bank";

const NOW = new Date("2026-12-10T15:00:00Z");
const CHAN = "820000000000000001";
const BOT_POST = "830000000000000000";
const MSG = "830000000000000005";
const OLD_USER = "300000000000000000";

const pool = await servable({ pool: "discord" });
const tf = pool.find((q) => q.type === "true_false")!;
const correctText = tf.answer === "true" ? "true" : "false";
const wrongText = tf.answer === "true" ? "false" : "true";

const closesAt = new Date(NOW.getTime() - 56_000);
const lapsedRound = { id: 7, questionId: tf.id, channelId: CHAN, messageId: BOT_POST, rewardPep: 20, openedAt: new Date(NOW.getTime() - 656_000), closesAt };
const ts = `<t:${Math.floor(closesAt.getTime() / 1000)}:t>`;

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
const input = (content: string, over: Record<string, string> = {}) => ({ channelId: CHAN, messageId: MSG, discordId: OLD_USER, content, ...over });
const flush = () => Promise.all(deferred.map((f) => f()));

beforeEach(() => {
  deferred = [];
  vi.mocked(findOpenRound).mockReset();
  vi.mocked(findOpenRound).mockResolvedValue(null);
  vi.mocked(findLapsedRound).mockReset();
  vi.mocked(findLapsedRound).mockResolvedValue(lapsedRound as never);
  vi.mocked(expireLapsedRound).mockClear();
  vi.mocked(claimWin).mockReset();
});

describe("a typed answer after closing time", () => {
  it("expires the round after the response and replies 'Too late' to a correct answer", async () => {
    const d = deps();
    expect(await processAnswer(input(correctText), d)).toEqual({ status: "not_won", why: "late" });
    expect(expireLapsedRound).not.toHaveBeenCalled(); // deferred: the handler is not blocked
    await flush();
    expect(expireLapsedRound).toHaveBeenCalledTimes(1);
    expect(d.post).toHaveBeenCalledTimes(1);
    const [chan, body] = vi.mocked(d.post).mock.calls[0];
    expect(chan).toBe(CHAN);
    expect(body.content).toBe(`⌛ Too late, the round closed at ${ts}.`);
    expect(body.message_reference).toMatchObject({ message_id: MSG });
    expect(claimWin).not.toHaveBeenCalled();
  });

  it("the reveal is posted before the reply", async () => {
    const order: string[] = [];
    vi.mocked(expireLapsedRound).mockImplementationOnce(async () => {
      order.push("expire");
      return true;
    });
    const d = deps({ post: vi.fn(async () => (order.push("reply"), { id: "1" })) });
    await processAnswer(input(correctText), d);
    await flush();
    expect(order).toEqual(["expire", "reply"]);
  });

  it("a wrong answer still expires the round but gets no reply", async () => {
    const d = deps();
    expect(await processAnswer(input(wrongText), d)).toEqual({ status: "no_round" });
    await flush();
    expect(expireLapsedRound).toHaveBeenCalledTimes(1);
    expect(d.post).not.toHaveBeenCalled();
  });

  it("chatter expires the round and gets no reply", async () => {
    const d = deps();
    await processAnswer(input("hey everyone, how is the call going today friends"), d);
    await flush();
    expect(expireLapsedRound).toHaveBeenCalledTimes(1);
    expect(d.post).not.toHaveBeenCalled();
  });

  it("a message from before the question gets no 'Too late'", async () => {
    const d = deps();
    await processAnswer(input(correctText, { messageId: "829999999999999999" }), d);
    await flush();
    expect(d.post).not.toHaveBeenCalled();
  });

  it("a failing reply never throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const d = deps({ post: vi.fn(async () => { throw new Error("boom"); }) });
    await processAnswer(input(correctText), d);
    await expect(flush()).resolves.toBeDefined();
  });

  it("no lapsed round either: nothing is deferred", async () => {
    vi.mocked(findLapsedRound).mockResolvedValue(null);
    expect(await processAnswer(input(correctText), deps())).toEqual({ status: "no_round" });
    expect(deferred).toHaveLength(0);
    expect(expireLapsedRound).not.toHaveBeenCalled();
  });
});

describe("a reaction pick after closing time", () => {
  it("expires the round and never replies", async () => {
    const d = deps();
    expect(await processReaction({ channelId: CHAN, messageId: BOT_POST, discordId: OLD_USER, emoji: { name: "👍" } as never }, d)).toEqual({ status: "no_round" });
    await flush();
    expect(expireLapsedRound).toHaveBeenCalledTimes(1);
    expect(d.post).not.toHaveBeenCalled();
  });
});
