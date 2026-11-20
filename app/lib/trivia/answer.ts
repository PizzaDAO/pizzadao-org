// app/lib/trivia/answer.ts
//
// One typed answer from the recorder (plans/trivia.md sections 5 to 7): find the channel's open round, judge the text
// with the pure matcher, and run the atomic claim. The recorder is a thin forwarder; everything that decides lives
// here (bank, settings, caps). Answers reach this in Discord order (the recorder's per-channel serial queue).
import { fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";
import { getQuestion } from "./bank";
import { accountOldEnough, ACK_REACTION, attemptsPerRound, MIN_ACCOUNT_AGE_DAYS, OUT_OF_TRIES_REACTION, reactionAttemptKey, REQUIRE_MEMBER, snowflakeAfter, snowflakeMs, WRONG_ATTEMPT_REACTION } from "./config";
import { emojiToReaction, judgeReaction, type ReactionEmoji } from "./emoji";
import { markWrongAttempt, removeMemberReaction } from "./reactions";
import { hasReportWord, isFlagEmoji, recordReport, roundByQuestionPost, type ReportOutcome, type ReportableRound } from "./reports";
import { match } from "./match";
import { announceWin, claimWin, defaultPostDeps, findAttemptByMessage, findOpenRound, hasRecentAttempt, type ClaimResult, type Eligibility, type PostDeps } from "./rounds";

export interface AnswerInput {
  channelId: string;
  /** The answer message's id. */
  messageId: string;
  /** Its author. */
  discordId: string;
  content: string;
  /** The message this one replies to (Discord `message_reference`), when it is a reply. */
  replyTo?: string;
}

export type AnswerOutcome =
  | { status: "off" }
  | { status: "no_round" }
  | { status: "ignored"; why: "before_question" | "rate_limited" | "not_an_answer" | "no_question" | "not_current_message" | "not_a_choice" }
  | { status: "wrong" }
  | { status: "won"; rewardPep: number; paid: boolean }
  | { status: "not_won"; why: "not_member" | "too_young" | "daily_cap" | "late" | "closed" | "attempts_exhausted" }
  | { status: "duplicate" }
  | { status: "reported"; pulled: boolean };

export interface AnswerDeps extends PostDeps {
  now(): Date;
  isMember(discordId: string): Promise<boolean>;
  /** The stored attempt for this message, if any (a recorder retry). Checked before anything else. */
  findAttempt(messageId: string): Promise<{ correct: boolean } | null>;
  /** True when this member already has an attempt in this round in the last 2 seconds (extras are ignored). */
  throttled(roundId: number, discordId: string, now: Date): Promise<boolean>;
  /** Remove a member's reaction after their attempt (never throws; absent: nothing is removed). */
  removeReaction?(channelId: string, messageId: string, reaction: string, userId: string): Promise<void>;
  /** The question post a message or reaction is about, and recording a report (default: the real ones). */
  roundByPost?(messageId: string, now: Date): Promise<ReportableRound | null>;
  recordReport?(input: { questionId: string; discordId: string; text: string; now: Date; eligible?: boolean }): Promise<ReportOutcome>;
  /** Add reactions to a member's own message (the 👀 on a report reply). Never throws. */
  reactTo?(channelId: string, messageId: string, emojis: string[]): Promise<void>;
  /** Mark a wrong short-answer attempt on the member's own message (never throws; absent: nothing is added). */
  markWrong?(channelId: string, messageId: string, emojis: string[]): Promise<void>;
  /** Run after the response (Next after()): replies are posted off the request path. */
  defer(fn: () => Promise<void>): void;
}

export const defaultAnswerDeps = (defer: (fn: () => Promise<void>) => void): AnswerDeps => ({
  ...defaultPostDeps,
  now: () => new Date(),
  isMember: async (id) => !!(await fetchMemberIdByDiscordId(id)),
  findAttempt: findAttemptByMessage,
  throttled: (roundId, id, now) => hasRecentAttempt(roundId, id, now),
  removeReaction: removeMemberReaction,
  markWrong: markWrongAttempt,
  reactTo: markWrongAttempt,
  roundByPost: roundByQuestionPost,
  recordReport: (i) => recordReport(i),
  defer,
});

export { accountOldEnough };

/** The caller has already checked that trivia is live. Never throws for bad input (it is `ignored`). */
export async function processAnswer(input: AnswerInput, deps: AnswerDeps): Promise<AnswerOutcome> {
  const now = deps.now();
  // A reply to a question post that says the question is bad is a report, not an answer (see tryReplyReport).
  if (input.replyTo) {
    const reported = await tryReplyReport(input, input.replyTo, now, deps);
    if (reported) return reported;
  }
  const round = await findOpenRound(input.channelId, now);
  if (!round) return { status: "no_round" };

  // Only messages after the question count: after the bot's post when we know its id, else after the round opened.
  if (round.messageId ? !snowflakeAfter(input.messageId, round.messageId) : snowflakeMs(input.messageId) < round.openedAt.getTime()) {
    return { status: "ignored", why: "before_question" };
  }

  const question = await getQuestion(round.questionId);
  if (!question) return { status: "ignored", why: "no_question" };

  // A retry of a message already recorded (the recorder retries after a 5xx) is answered from the store, before any
  // limit: the 2 s throttle below counts recorded attempts, so a retry can never be throttled by its own first try.
  if (await deps.findAttempt(input.messageId)) return { status: "duplicate" };

  // Chatter that is not an answer is ignored and never recorded. Discord rounds accept only explicit true/false tokens.
  const verdict = match(question, input.content, { strictBoolean: true }).verdict;
  if (verdict === "ignore") return { status: "ignored", why: "not_an_answer" };
  if (await deps.throttled(round.id, input.discordId, now)) return { status: "ignored", why: "rate_limited" };

  const correct = verdict === "correct";
  const eligibility = await eligibilityFor(input.discordId, correct, now, deps);

  const result = await claimWin({
    round: { id: round.id, rewardPep: round.rewardPep, questionId: round.questionId },
    discordId: input.discordId,
    messageId: input.messageId,
    answerText: input.content,
    correct,
    eligibility,
    maxAttempts: attemptsPerRound(question),
    now,
  });

  // Only a short-answer attempt graded wrong is marked on the member's message (a cross, plus a lock on their last try).
  // True/false and multiple choice stay silent: one try, and a public cross on "true" would reveal the answer.
  if (result.kind === "wrong" && question.type === "short_answer" && round.channelId && deps.markWrong) {
    const mark = deps.markWrong;
    const channelId = round.channelId;
    const emojis = [WRONG_ATTEMPT_REACTION, ...(result.attemptsUsed !== undefined && result.attemptsUsed >= attemptsPerRound(question) ? [OUT_OF_TRIES_REACTION] : [])];
    deps.defer(() => mark(channelId, input.messageId, emojis));
  }

  return finish(result, input, round, deps);
}

/** Only a correct answer needs the eligibility checks (cheap account age first, then membership). */
async function eligibilityFor(discordId: string, correct: boolean, now: Date, deps: AnswerDeps): Promise<Eligibility> {
  if (!correct) return { ok: true };
  if (!accountOldEnough(discordId, now)) return { ok: false, reason: "too_young" };
  if (REQUIRE_MEMBER && !(await deps.isMember(discordId))) return { ok: false, reason: "not_member" };
  return { ok: true };
}

/**
 * A member who may report: an onboarded member on an account old enough. (Without this, throwaway accounts could pull
 * any question with three flags.) Same two rules as winning.
 */
async function mayReport(discordId: string, now: Date, deps: AnswerDeps): Promise<boolean> {
  return accountOldEnough(discordId, now) && (!REQUIRE_MEMBER || (await deps.isMember(discordId)));
}

/**
 * A reply to a question post (current or within the last 7 days) that contains a report word ("bad", "wrong", "broken",
 * "report", "flag", "incorrect", "outdated") is recorded as a report with the reply text and gets a 👀, instead of
 * being graded. In an OPEN round a reply could also be a guess, so there:
 *   - a single word is never a report ("wrong" may be a guess; it is graded as before), and
 *   - a reply that is a correct answer is graded, not reported.
 * Anything else with a report word (several words, none of them the right answer) is a report. Replies to a past
 * round's post, or after the round closed, are reports whenever they contain a report word. Returns null to carry on
 * as an ordinary answer.
 */
async function tryReplyReport(input: AnswerInput, replyTo: string, now: Date, deps: AnswerDeps): Promise<AnswerOutcome | null> {
  if (!deps.roundByPost || !deps.recordReport || !hasReportWord(input.content)) return null;
  const round = await deps.roundByPost(replyTo, now);
  if (!round) return null;
  const question = await getQuestion(round.questionId);
  if (!question) return null;
  const open = round.status === "OPEN" && round.closesAt > now;
  if (open) {
    if (input.content.trim().split(/\s+/).length < 2) return null;
    if (match(question, input.content, { strictBoolean: true }).verdict === "correct") return null;
  }
  if (!(await mayReport(input.discordId, now, deps))) return null;
  const out = await deps.recordReport({ questionId: round.questionId, discordId: input.discordId, text: `reply: ${input.content}`, now, eligible: true });
  if (out.status === "duplicate") return { status: "duplicate" };
  const react = deps.reactTo;
  if (react) deps.defer(() => react(input.channelId, input.messageId, [ACK_REACTION]));
  return { status: "reported", pulled: out.pulled };
}

/**
 * A member's flag reaction on a question post, the current one or one from the last 7 days: a report with the text
 * "flagged from Discord". It is never an answer attempt (it never reaches the attempt tables or the caps) and is never
 * judged as a pick. The member's flag is removed afterwards so the count does not snowball (the bot's own stays).
 * Posts that are not question posts, and members who may not report, are left alone.
 */
async function processFlag(input: ReactionInput, deps: AnswerDeps): Promise<AnswerOutcome> {
  const now = deps.now();
  if (!deps.roundByPost || !deps.recordReport) return { status: "ignored", why: "not_a_choice" };
  const round = await deps.roundByPost(input.messageId, now);
  if (!round) return { status: "ignored", why: "not_current_message" };
  if (!(await mayReport(input.discordId, now, deps))) return { status: "ignored", why: "not_a_choice" };
  const reaction = emojiToReaction(input.emoji);
  const removal: Promise<void> =
    reaction && deps.removeReaction ? deps.removeReaction(input.channelId, input.messageId, reaction, input.discordId).catch(() => undefined) : Promise.resolve();
  try {
    const out = await deps.recordReport({ questionId: round.questionId, discordId: input.discordId, text: "flagged from Discord", now, eligible: true });
    return out.status === "duplicate" ? { status: "duplicate" } : { status: "reported", pulled: out.pulled };
  } finally {
    await removal;
  }
}

export interface ReactionInput {
  channelId: string;
  /** The message that was reacted to: it must be the current round's question post. */
  messageId: string;
  discordId: string;
  emoji: ReactionEmoji;
}

/**
 * A reaction on the question post, as a choice (plans/trivia.md section 17). The same rules as a typed answer: the
 * open round, eligibility, the attempt cap (1 for true/false and multiple choice), the dedupe key and claimWin. The
 * dedupe key is `reaction:<question message>:<member>`, so a member's FIRST reaction is their only reaction attempt
 * (their later ones are duplicates). A pick on the current question is removed immediately, in parallel with the work and whatever the outcome, so
 * the reaction counts never show what others chose; reactions after the round closed, on other messages, or with
 * other emoji are not touched.
 */
export async function processReaction(input: ReactionInput, deps: AnswerDeps): Promise<AnswerOutcome> {
  // The flag is a report, handled before (and apart from) the picks: no round needs to be open, no attempt is made.
  if (isFlagEmoji(input.emoji)) return processFlag(input, deps);
  const now = deps.now();
  const round = await findOpenRound(input.channelId, now);
  if (!round) return { status: "no_round" };
  if (!round.messageId || round.messageId !== input.messageId) return { status: "ignored", why: "not_current_message" };

  const question = await getQuestion(round.questionId);
  if (!question) return { status: "ignored", why: "no_question" };
  const judged = judgeReaction(question, input.emoji);
  if (!judged) return { status: "ignored", why: "not_a_choice" };

  // From here the pick is hidden again, and it must disappear at the same moment whatever the outcome: removal starts
  // right now, before the duplicate check, the eligibility lookups (a Sheets read for correct picks only) and the claim,
  // so neither the verdict nor the load can be told from how long the reaction stays. It runs alongside them and is
  // awaited before returning (the request must not end first); a failure is swallowed (the remover logs it).
  const reaction = emojiToReaction(input.emoji);
  const removal: Promise<void> =
    reaction && deps.removeReaction
      ? deps.removeReaction(input.channelId, input.messageId, reaction, input.discordId).catch(() => undefined)
      : Promise.resolve();
  try {
    const key = reactionAttemptKey(input.messageId, input.discordId);
    if (await deps.findAttempt(key)) return { status: "duplicate" };

    const eligibility = await eligibilityFor(input.discordId, judged.correct, now, deps);
    const result = await claimWin({
      round: { id: round.id, rewardPep: round.rewardPep, questionId: round.questionId },
      discordId: input.discordId,
      messageId: key,
      answerText: `reaction:${judged.label}`,
      correct: judged.correct,
      eligibility,
      maxAttempts: attemptsPerRound(question),
      now,
    });
    return finish(result, { discordId: input.discordId, messageId: key, replyToId: input.messageId }, round, deps);
  } finally {
    await removal;
  }
}

function finish(
  result: ClaimResult,
  input: { discordId: string; messageId: string; replyToId?: string },
  round: { id: number; channelId: string | null; questionId: string },
  deps: AnswerDeps,
): AnswerOutcome {
  switch (result.kind) {
    case "won":
      deps.defer(() =>
        announceWin(round, { discordId: input.discordId, messageId: input.messageId, rewardPep: result.rewardPep, paid: result.paid, ...(input.replyToId ? { replyToId: input.replyToId } : {}) }, deps),
      );
      return { status: "won", rewardPep: result.rewardPep, paid: result.paid };
    case "wrong":
      return { status: "wrong" }; // wrong guesses get no reply (keeps the channel readable)
    case "ineligible":
    case "daily_cap":
      // No public reply: "Correct!" to someone who cannot win, while the round is still open, would tell everyone the
      // answer. The attempt is stored as correct (and ineligible); the round stays open for eligible members.
      return { status: "not_won", why: result.kind === "daily_cap" ? "daily_cap" : result.reason };
    case "late":
    case "closed":
    case "attempts_exhausted":
      return { status: "not_won", why: result.kind };
    case "duplicate":
      return { status: "duplicate" };
  }
}
