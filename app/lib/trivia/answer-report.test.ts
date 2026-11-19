// @vitest-environment node
// Reports from Discord: the flag reaction and replies to a question post. Never answer attempts.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/lib/db");
vi.mock("@/app/lib/sheets/member-repository", () => ({ fetchMemberIdByDiscordId: vi.fn() }));
vi.mock("./rounds", () => ({ findOpenRound: vi.fn(), claimWin: vi.fn(), announceWin: vi.fn(async () => undefined), defaultPostDeps: { post: vi.fn() } }));

import { processAnswer, processReaction, type AnswerDeps } from "./answer";
import { claimWin, findOpenRound } from "./rounds";
import { hasReportWord, isFlagEmoji, type ReportableRound } from "./reports";
import { ACK_REACTION, CHOICE_EMOJI, FLAG_REACTION } from "./config";
import { getBank } from "./bank";
import type { TriviaQuestion } from "./schema";

const NOW = new Date("2026-12-10T15:00:00Z");
const CHAN = "820000000000000001";
const QMSG = "830000000000000000"; // an old, closed round's question post
const CURRENT = "830000000000000100"; // the open round's question post
const USER = "300000000000000000";
const YOUNG = String(BigInt(NOW.getTime() - 2 * 86_400_000 - 1420070400000) << BigInt(22));
const FLAG = { id: null, name: FLAG_REACTION };

const bank = getBank().questions.filter((q) => q.status === "approved");
const tf = bank.find((q) => q.type === "true_false")!;
const mc = bank.find((q) => q.id === "jc-006")!;
const short = bank.find((q) => q.type === "short_answer" && q.match.kind === "text")!;

let deferred: Array<() => Promise<void>>;
let removeReaction: ReturnType<typeof vi.fn>;
let reactTo: ReturnType<typeof vi.fn>;
let recordReport: ReturnType<typeof vi.fn>;
let rounds: Record<string, ReportableRound>;

const closed = (q: TriviaQuestion, id: number): ReportableRound => ({ id, questionId: q.id, status: "EXPIRED", messageId: QMSG, closesAt: new Date(NOW.getTime() - 3_600_000) });
const open = (q: TriviaQuestion): ReportableRound => ({ id: 9, questionId: q.id, status: "OPEN", messageId: CURRENT, closesAt: new Date(NOW.getTime() + 300_000) });

function deps(over: Partial<AnswerDeps> = {}): AnswerDeps {
  return {
    now: () => NOW,
    isMember: vi.fn(async () => true),
    findAttempt: vi.fn(async () => null),
    throttled: vi.fn(async () => false),
    removeReaction: removeReaction as unknown as AnswerDeps["removeReaction"],
    reactTo: reactTo as unknown as AnswerDeps["reactTo"],
    roundByPost: vi.fn(async (id: string) => rounds[id] ?? null),
    recordReport: recordReport as unknown as AnswerDeps["recordReport"],
    defer: (fn) => void deferred.push(fn),
    post: vi.fn(async () => ({ id: "1" })),
    ...over,
  };
}
const flush = async () => {
  for (const f of deferred) await f();
};
const reactionInput = (emoji: { id: string | null; name: string | null }, over: Record<string, unknown> = {}) => ({ channelId: CHAN, messageId: QMSG, discordId: USER, emoji, ...over });
const replyInput = (content: string, replyTo: string, over: Record<string, unknown> = {}) => ({ channelId: CHAN, messageId: "830000000000000900", discordId: USER, content, replyTo, ...over });

beforeEach(() => {
  deferred = [];
  removeReaction = vi.fn(async () => undefined);
  reactTo = vi.fn(async () => undefined);
  recordReport = vi.fn(async () => ({ status: "recorded", pulled: false, eligible: true }));
  rounds = { [QMSG]: closed(tf, 3), [CURRENT]: open(tf) };
  vi.mocked(claimWin).mockReset();
  vi.mocked(findOpenRound).mockReset();
  vi.mocked(findOpenRound).mockResolvedValue(null);
});

describe("helpers", () => {
  it("recognises the report words as whole words", () => {
    for (const t of ["this one is bad", "WRONG answer", "broken", "please report this", "flag it", "that is incorrect", "outdated now"]) expect(hasReportWord(t)).toBe(true);
    for (const t of ["badger", "flagship", "bandwidth", "true", "I love pizza", "reporter"]) expect(hasReportWord(t)).toBe(false);
  });
  it("the flag emoji, with or without a variation selector, and not a custom one", () => {
    expect(isFlagEmoji(FLAG)).toBe(true);
    expect(isFlagEmoji({ id: null, name: `${FLAG_REACTION}️` })).toBe(true);
    expect(isFlagEmoji({ id: "1", name: FLAG_REACTION })).toBe(false);
    expect(isFlagEmoji({ id: null, name: "✅" })).toBe(false);
  });
});

describe("the flag reaction", () => {
  it("records a report 'flagged from Discord' on a question post, even with no round open, and is never an attempt", async () => {
    const d = deps();
    expect(await processReaction(reactionInput(FLAG), d)).toEqual({ status: "reported", pulled: false });
    expect(recordReport).toHaveBeenCalledWith({ questionId: tf.id, discordId: USER, text: "flagged from Discord", now: NOW, eligible: true });
    // never graded, never claimed, never looked up as an attempt, no round lookup
    expect(claimWin).not.toHaveBeenCalled();
    expect(findOpenRound).not.toHaveBeenCalled();
    expect(d.findAttempt).not.toHaveBeenCalled();
    expect(d.throttled).not.toHaveBeenCalled();
  });

  it("works on the open round's post too, without touching its attempts (the cap does not apply)", async () => {
    vi.mocked(findOpenRound).mockResolvedValue({ id: 9, questionId: tf.id, channelId: CHAN, messageId: CURRENT } as never);
    const d = deps();
    expect(await processReaction(reactionInput(FLAG, { messageId: CURRENT }), d)).toEqual({ status: "reported", pulled: false });
    expect(claimWin).not.toHaveBeenCalled();
    expect(d.findAttempt).not.toHaveBeenCalled();
  });

  it("reports on the post's own question: the old post's question, not the current one", async () => {
    rounds[QMSG] = closed(mc, 4);
    await processReaction(reactionInput(FLAG), deps());
    expect(recordReport).toHaveBeenCalledWith(expect.objectContaining({ questionId: mc.id }));
  });

  it("the member's flag is removed afterwards (the count does not snowball), also when it was a duplicate", async () => {
    await processReaction(reactionInput(FLAG), deps());
    await flush();
    expect(removeReaction).toHaveBeenCalledWith(CHAN, QMSG, FLAG_REACTION, USER);
    removeReaction.mockClear();
    recordReport.mockResolvedValue({ status: "duplicate" });
    expect(await processReaction(reactionInput(FLAG), deps())).toEqual({ status: "duplicate" });
    expect(removeReaction).toHaveBeenCalledTimes(1);
  });

  it("a failing removal does not change the outcome", async () => {
    removeReaction.mockRejectedValue(new Error("Missing Permissions"));
    expect(await processReaction(reactionInput(FLAG), deps())).toEqual({ status: "reported", pulled: false });
  });

  it("a flag on a message that is not a question post (or older than 7 days) is ignored and left alone", async () => {
    const d = deps();
    expect(await processReaction(reactionInput(FLAG, { messageId: "830000000000000777" }), d)).toEqual({ status: "ignored", why: "not_current_message" });
    expect(recordReport).not.toHaveBeenCalled();
    expect(removeReaction).not.toHaveBeenCalled();
  });

  it("a non-member or a young account cannot report (so throwaway accounts cannot pull a question)", async () => {
    expect(await processReaction(reactionInput(FLAG), deps({ isMember: vi.fn(async () => false) }))).toMatchObject({ status: "ignored" });
    expect(await processReaction(reactionInput(FLAG, { discordId: YOUNG }), deps())).toMatchObject({ status: "ignored" });
    expect(recordReport).not.toHaveBeenCalled();
  });

  it("is not a pick: it is never judged against the choices, whatever the question", async () => {
    for (const q of [tf, mc, short]) {
      rounds[QMSG] = closed(q, 5);
      recordReport.mockClear();
      expect((await processReaction(reactionInput(FLAG), deps())).status).toBe("reported");
    }
    expect(claimWin).not.toHaveBeenCalled();
  });

  it("the picks still work the same: a turtle on the open round is an attempt, not a report", async () => {
    rounds[CURRENT] = open(mc);
    vi.mocked(findOpenRound).mockResolvedValue({ id: 9, questionId: mc.id, channelId: CHAN, messageId: CURRENT, rewardPep: 20, openedAt: new Date(NOW.getTime() - 60_000), closesAt: new Date(NOW.getTime() + 300_000) } as never);
    vi.mocked(claimWin).mockResolvedValue({ kind: "wrong", attemptsUsed: 1 });
    await processReaction(reactionInput({ id: CHOICE_EMOJI[0].id, name: CHOICE_EMOJI[0].name }, { messageId: CURRENT }), deps());
    expect(claimWin).toHaveBeenCalledTimes(1);
    expect(recordReport).not.toHaveBeenCalled();
  });
});

describe("replies to a question post", () => {
  it("a reply to a past post with a report word is a report with the reply text, and gets a 👀", async () => {
    const d = deps();
    expect(await processAnswer(replyInput("this one is bad", QMSG), d)).toEqual({ status: "reported", pulled: false });
    expect(recordReport).toHaveBeenCalledWith({ questionId: tf.id, discordId: USER, text: "reply: this one is bad", now: NOW, eligible: true });
    await flush();
    expect(reactTo).toHaveBeenCalledWith(CHAN, "830000000000000900", [ACK_REACTION]);
    expect(claimWin).not.toHaveBeenCalled(); // not graded
  });

  it("even a single word is a report once the round is over", async () => {
    expect((await processAnswer(replyInput("wrong", QMSG), deps())).status).toBe("reported");
  });

  it("a reply with no report word is an ordinary message (here: no round, so nothing happens)", async () => {
    expect(await processAnswer(replyInput("lol nice one", QMSG), deps())).toEqual({ status: "no_round" });
    expect(recordReport).not.toHaveBeenCalled();
  });

  it("a reply to some other message is an ordinary message", async () => {
    expect(await processAnswer(replyInput("this is bad", "830000000000000777"), deps())).toEqual({ status: "no_round" });
    expect(recordReport).not.toHaveBeenCalled();
  });

  describe("in an open round a reply could be a guess", () => {
    const openRound = (q: TriviaQuestion) => {
      rounds[CURRENT] = open(q);
      vi.mocked(findOpenRound).mockResolvedValue({ id: 9, questionId: q.id, channelId: CHAN, messageId: CURRENT, rewardPep: 20, openedAt: new Date(NOW.getTime() - 60_000), closesAt: new Date(NOW.getTime() + 300_000) } as never);
      vi.mocked(claimWin).mockResolvedValue({ kind: "wrong", attemptsUsed: 1 });
    };

    it("a single word is never a report: 'wrong' is graded as an answer as before", async () => {
      openRound(short);
      const out = await processAnswer(replyInput("wrong", CURRENT), deps());
      expect(out.status).toBe("wrong");
      expect(recordReport).not.toHaveBeenCalled();
      expect(claimWin).toHaveBeenCalledTimes(1);
    });

    it("several words with a report word that are not the right answer are a report, not a graded attempt", async () => {
      openRound(short);
      const out = await processAnswer(replyInput("this question is bad", CURRENT), deps());
      expect(out).toEqual({ status: "reported", pulled: false });
      expect(claimWin).not.toHaveBeenCalled();
    });

    it("a reply that is the right answer is graded even if it contains a report word", async () => {
      const num = bank.find((q) => q.id === "pd-001")!; // 10,000 bitcoins
      openRound(num);
      vi.mocked(claimWin).mockResolvedValue({ kind: "won", rewardPep: 20, paid: true });
      const out = await processAnswer(replyInput("bad guess maybe 10000", CURRENT), deps());
      expect(out.status).toBe("won");
      expect(recordReport).not.toHaveBeenCalled();
    });

    it("a reply with no report word is graded as an answer", async () => {
      openRound(short);
      await processAnswer(replyInput("Hal Finney", CURRENT), deps());
      expect(claimWin).toHaveBeenCalledTimes(1);
      expect(recordReport).not.toHaveBeenCalled();
    });

    it("true/false: 'wrong' alone is not a valid Discord answer and not a report; 'this is wrong' is a report", async () => {
      openRound(tf);
      expect(await processAnswer(replyInput("wrong", CURRENT), deps())).toEqual({ status: "ignored", why: "not_an_answer" });
      expect(recordReport).not.toHaveBeenCalled();
      expect((await processAnswer(replyInput("this is wrong", CURRENT), deps())).status).toBe("reported");
    });
  });

  it("a duplicate report (same member, same question) is recorded once: no second 👀", async () => {
    recordReport.mockResolvedValue({ status: "duplicate" });
    expect(await processAnswer(replyInput("this one is bad", QMSG), deps())).toEqual({ status: "duplicate" });
    await flush();
    expect(reactTo).not.toHaveBeenCalled();
  });

  it("a member who may not report is treated as an ordinary message (not recorded)", async () => {
    const out = await processAnswer(replyInput("this one is bad", QMSG), deps({ isMember: vi.fn(async () => false) }));
    expect(out).toEqual({ status: "no_round" });
    expect(recordReport).not.toHaveBeenCalled();
  });

  it("the auto-pull outcome is passed through (nothing is said publicly)", async () => {
    recordReport.mockResolvedValue({ status: "recorded", pulled: true, eligible: true });
    const d = deps();
    expect(await processAnswer(replyInput("broken question", QMSG), d)).toEqual({ status: "reported", pulled: true });
    await flush();
    expect(d.post).not.toHaveBeenCalled();
  });
});
