// @vitest-environment node
// processReaction with the round store mocked (the real-database path is in trivia.concurrency.test.ts).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/lib/db");
vi.mock("@/app/lib/sheets/member-repository", () => ({ fetchMemberIdByDiscordId: vi.fn() }));
vi.mock("./rounds", () => ({ findOpenRound: vi.fn(), claimWin: vi.fn(), announceWin: vi.fn(async () => undefined), defaultPostDeps: { post: vi.fn() } }));

import { processReaction, type AnswerDeps } from "./answer";
import { announceWin, claimWin, findOpenRound } from "./rounds";
import { getBank } from "./bank";
import { CHOICE_EMOJI, CHOICE_FALLBACK, reactionAttemptKey } from "./config";
import type { TriviaQuestion } from "./schema";

const NOW = new Date("2026-12-10T15:00:00Z");
const CHAN = "820000000000000001";
const QMSG = "830000000000000000";
const USER = "300000000000000000";
const NEW_USER = String(BigInt(NOW.getTime() - 2 * 86_400_000 - 1420070400000) << BigInt(22));
const KEY = reactionAttemptKey(QMSG, USER);

const bank = getBank().questions;
const mc = bank.find((q) => q.id === "jc-006")!;
const tf = bank.find((q) => q.type === "true_false" && q.status === "approved")!;
const short = bank.find((q) => q.type === "short_answer" && q.status === "approved")!;
const rightIdx = mc.choices!.indexOf(mc.answer);
const turtle = (i: number) => ({ id: CHOICE_EMOJI[i].id, name: CHOICE_EMOJI[i].name });
const CHECK = { id: null, name: "✅" };
const CROSS = { id: null, name: "❌" };

const round = (q: TriviaQuestion, over: Record<string, unknown> = {}) => ({ id: 7, questionId: q.id, channelId: CHAN, messageId: QMSG, rewardPep: 20, openedAt: new Date(NOW.getTime() - 60_000), closesAt: new Date(NOW.getTime() + 540_000), ...over });

let deferred: Array<() => Promise<void>>;
let removeReaction: ReturnType<typeof vi.fn>;
function deps(over: Partial<AnswerDeps> = {}): AnswerDeps {
  return {
    now: () => NOW,
    isMember: vi.fn(async () => true),
    findAttempt: vi.fn(async () => null),
    throttled: vi.fn(async () => false),
    removeReaction: removeReaction as unknown as AnswerDeps["removeReaction"],
    defer: (fn) => void deferred.push(fn),
    post: vi.fn(async () => ({ id: "1" })),
    ...over,
  };
}
const input = (emoji: { id: string | null; name: string | null }, over: Record<string, unknown> = {}) => ({ channelId: CHAN, messageId: QMSG, discordId: USER, emoji, ...over });
const flush = async () => {
  for (const f of deferred) await f();
};

beforeEach(() => {
  deferred = [];
  removeReaction = vi.fn(async () => undefined);
  vi.mocked(claimWin).mockReset();
  vi.mocked(claimWin).mockResolvedValue({ kind: "wrong" });
  vi.mocked(findOpenRound).mockReset();
  vi.mocked(findOpenRound).mockResolvedValue(round(mc) as never);
  vi.mocked(announceWin).mockClear();
});

describe("processReaction: which reactions count", () => {
  it("no open round (a reaction after the round closed): ignored and the reaction is left alone", async () => {
    vi.mocked(findOpenRound).mockResolvedValue(null);
    expect(await processReaction(input(turtle(0)), deps())).toEqual({ status: "no_round" });
    expect(claimWin).not.toHaveBeenCalled();
    expect(deferred).toHaveLength(0);
  });

  it("a reaction on any message other than the current question post is ignored and left alone", async () => {
    expect(await processReaction(input(turtle(0), { messageId: "830000000000000099" }), deps())).toEqual({ status: "ignored", why: "not_current_message" });
    vi.mocked(findOpenRound).mockResolvedValue(round(mc, { messageId: null }) as never); // post id not stored yet
    expect(await processReaction(input(turtle(0)), deps())).toEqual({ status: "ignored", why: "not_current_message" });
    expect(claimWin).not.toHaveBeenCalled();
    expect(deferred).toHaveLength(0);
  });

  it("an emoji that is not one of this question's picks is ignored and left alone (a pizza emoji, a turtle on true/false)", async () => {
    expect(await processReaction(input({ id: null, name: "\u{1F355}" }), deps())).toEqual({ status: "ignored", why: "not_a_choice" });
    vi.mocked(findOpenRound).mockResolvedValue(round(tf) as never);
    expect(await processReaction(input(turtle(0)), deps())).toEqual({ status: "ignored", why: "not_a_choice" });
    vi.mocked(findOpenRound).mockResolvedValue(round(short) as never);
    expect(await processReaction(input(CHECK), deps())).toEqual({ status: "ignored", why: "not_a_choice" });
    expect(claimWin).not.toHaveBeenCalled();
    expect(deferred).toHaveLength(0);
  });
});

describe("processReaction: judging and the claim", () => {
  it("maps each turtle to its choice and judges it against the answer", async () => {
    for (let i = 0; i < 4; i++) {
      vi.mocked(claimWin).mockClear();
      await processReaction(input(turtle(i)), deps());
      expect(vi.mocked(claimWin).mock.calls[0][0]).toMatchObject({ correct: i === rightIdx, answerText: `reaction:${String.fromCharCode(65 + i)}`, maxAttempts: 1 });
    }
  });

  it("the fallback letters map the same way", async () => {
    await processReaction(input({ id: null, name: CHOICE_FALLBACK[rightIdx] }), deps());
    expect(vi.mocked(claimWin).mock.calls[0][0]).toMatchObject({ correct: true });
  });

  it("true/false: the check and the cross, one attempt", async () => {
    vi.mocked(findOpenRound).mockResolvedValue(round(tf) as never);
    const t = tf.answer === "true";
    await processReaction(input(CHECK), deps());
    expect(vi.mocked(claimWin).mock.calls[0][0]).toMatchObject({ correct: t, maxAttempts: 1 });
    await processReaction(input(CROSS), deps());
    expect(vi.mocked(claimWin).mock.calls[1][0]).toMatchObject({ correct: !t, maxAttempts: 1 });
  });

  it("the dedupe key is reaction:<question message>:<member>, so the member's first reaction is the only attempt", async () => {
    await processReaction(input(turtle(0)), deps());
    await processReaction(input(turtle(1)), deps()); // a different emoji by the same member: the same key
    const keys = vi.mocked(claimWin).mock.calls.map((c) => c[0].messageId);
    expect(keys).toEqual([KEY, KEY]);
    expect(KEY).toBe(`reaction:${QMSG}:${USER}`);
  });

  it("a reaction whose key is already stored is a duplicate: nothing is claimed", async () => {
    const d = deps({ findAttempt: vi.fn(async () => ({ correct: true })) });
    expect(await processReaction(input(turtle(rightIdx)), d)).toEqual({ status: "duplicate" });
    expect(d.findAttempt).toHaveBeenCalledWith(KEY);
    expect(claimWin).not.toHaveBeenCalled();
  });

  it("the same eligibility rules as typing: young account and non-member cannot win, quietly", async () => {
    vi.mocked(claimWin).mockResolvedValue({ kind: "ineligible", reason: "too_young" });
    const young = deps();
    expect(await processReaction(input(turtle(rightIdx), { discordId: NEW_USER }), young)).toEqual({ status: "not_won", why: "too_young" });
    expect(vi.mocked(claimWin).mock.calls[0][0]).toMatchObject({ correct: true, eligibility: { ok: false, reason: "too_young" } });
    expect(young.isMember).not.toHaveBeenCalled();

    vi.mocked(claimWin).mockResolvedValue({ kind: "ineligible", reason: "not_member" });
    const outsider = deps({ isMember: vi.fn(async () => false) });
    expect(await processReaction(input(turtle(rightIdx)), outsider)).toEqual({ status: "not_won", why: "not_member" });
    expect(outsider.post).not.toHaveBeenCalled(); // no public reply: it would leak the answer
  });

  it("a wrong pick does not look up membership; attempts exhausted and a late claim say nothing", async () => {
    const d = deps();
    await processReaction(input(turtle((rightIdx + 1) % 4)), d);
    expect(d.isMember).not.toHaveBeenCalled();
    vi.mocked(claimWin).mockResolvedValue({ kind: "attempts_exhausted" });
    expect(await processReaction(input(turtle(0)), deps())).toEqual({ status: "not_won", why: "attempts_exhausted" });
    vi.mocked(claimWin).mockResolvedValue({ kind: "late" });
    expect(await processReaction(input(turtle(rightIdx)), deps())).toEqual({ status: "not_won", why: "late" });
  });

  it("a win by reaction is announced as a reply to the question post (there is no answer message to reply to)", async () => {
    vi.mocked(claimWin).mockResolvedValue({ kind: "won", rewardPep: 20, paid: true });
    expect(await processReaction(input(turtle(rightIdx)), deps())).toEqual({ status: "won", rewardPep: 20, paid: true });
    await flush();
    expect(announceWin).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), expect.objectContaining({ discordId: USER, messageId: KEY, replyToId: QMSG, rewardPep: 20, paid: true }), expect.anything());
  });

  it("a dry-run win names the winner but pays nothing", async () => {
    vi.mocked(findOpenRound).mockResolvedValue(round(mc, { rewardPep: 0 }) as never);
    vi.mocked(claimWin).mockResolvedValue({ kind: "won", rewardPep: 0, paid: false });
    expect(await processReaction(input(turtle(rightIdx)), deps())).toEqual({ status: "won", rewardPep: 0, paid: false });
    expect(vi.mocked(claimWin).mock.calls[0][0].round.rewardPep).toBe(0);
  });
});

describe("processReaction: hiding the picks", () => {
  it("a pick is removed afterwards whatever the outcome (wrong, right, duplicate, exhausted, ineligible)", async () => {
    const outcomes: Array<[string, () => void, Partial<AnswerDeps>]> = [
      ["wrong", () => vi.mocked(claimWin).mockResolvedValue({ kind: "wrong" }), {}],
      ["won", () => vi.mocked(claimWin).mockResolvedValue({ kind: "won", rewardPep: 20, paid: true }), {}],
      ["exhausted", () => vi.mocked(claimWin).mockResolvedValue({ kind: "attempts_exhausted" }), {}],
      ["ineligible", () => vi.mocked(claimWin).mockResolvedValue({ kind: "ineligible", reason: "not_member" }), {}],
      ["duplicate", () => {}, { findAttempt: vi.fn(async () => ({ correct: false })) }],
    ];
    for (const [, setup, over] of outcomes) {
      deferred = [];
      removeReaction.mockClear();
      setup();
      await processReaction(input(turtle(2)), deps(over));
      await flush();
      expect(removeReaction).toHaveBeenCalledWith(CHAN, QMSG, `${CHOICE_EMOJI[2].name}:${CHOICE_EMOJI[2].id}`, USER);
    }
  });

  it("the removal starts before the duplicate check, the eligibility lookups and the claim, so every pick disappears at the same point", async () => {
    const order: string[] = [];
    removeReaction.mockImplementation(async () => void order.push("remove"));
    vi.mocked(claimWin).mockImplementation(async () => (order.push("claim"), { kind: "wrong" as const }));
    const d = deps({
      findAttempt: vi.fn(async () => (order.push("findAttempt"), null)),
      isMember: vi.fn(async () => (order.push("isMember"), true)),
    });
    await processReaction(input(turtle(rightIdx)), d);
    expect(order.indexOf("remove")).toBe(0);
    expect(order).toEqual(["remove", "findAttempt", "isMember", "claim"]);
    // a wrong pick (no membership lookup) is removed at the same point
    order.length = 0;
    await processReaction(input(turtle((rightIdx + 1) % 4)), d);
    expect(order[0]).toBe("remove");
  });

  it("a slow Sheets lookup for a correct pick does not delay its removal (it is already running)", async () => {
    let releaseMember: () => void = () => {};
    const gate = new Promise<void>((r) => (releaseMember = r));
    let removedAt = "";
    removeReaction.mockImplementation(async () => void (removedAt = "removed"));
    vi.mocked(claimWin).mockResolvedValue({ kind: "wrong" });
    const p = processReaction(input(turtle(rightIdx)), deps({ isMember: vi.fn(async () => (await gate, true)) }));
    await new Promise((r) => setTimeout(r, 5));
    expect(removedAt).toBe("removed"); // gone while the membership read is still pending
    releaseMember();
    await p;
  });

  it("the removal is awaited before the request ends, and a database error still hides the pick", async () => {
    let done = false;
    removeReaction.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      done = true;
    });
    vi.mocked(claimWin).mockRejectedValue(new Error("db"));
    await expect(processReaction(input(turtle(0)), deps())).rejects.toThrow("db");
    expect(done).toBe(true);
    expect(removeReaction).toHaveBeenCalledTimes(1);
  });

  it("a removal that fails does not change the outcome (the real remover never throws; a rejecting one is swallowed here)", async () => {
    removeReaction.mockRejectedValue(new Error("Missing Permissions"));
    const out = await processReaction(input(turtle(1)), deps());
    expect(out).toEqual({ status: "wrong" });
  });

  it("unicode reactions are removed in their plain form", async () => {
    vi.mocked(findOpenRound).mockResolvedValue(round(tf) as never);
    await processReaction(input(CROSS), deps());
    await flush();
    expect(removeReaction).toHaveBeenCalledWith(CHAN, QMSG, "❌", USER);
  });
});
