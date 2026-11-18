// app/lib/trivia/answer.ts
//
// One typed answer from the recorder (plans/trivia.md sections 5 to 7): find the channel's open round, judge the text
// with the pure matcher, and run the atomic claim. The recorder is a thin forwarder; everything that decides lives
// here (bank, settings, caps). Answers reach this in Discord order (the recorder's per-channel serial queue).
import { fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";
import { getQuestion } from "./bank";
import { attemptsPerRound, MIN_ACCOUNT_AGE_DAYS, REQUIRE_MEMBER, snowflakeAfter, snowflakeMs } from "./config";
import { match } from "./match";
import { announceWin, claimWin, defaultPostDeps, findAttemptByMessage, findOpenRound, hasRecentAttempt, type ClaimResult, type Eligibility, type PostDeps } from "./rounds";

export interface AnswerInput {
  channelId: string;
  /** The answer message's id. */
  messageId: string;
  /** Its author. */
  discordId: string;
  content: string;
}

export type AnswerOutcome =
  | { status: "off" }
  | { status: "no_round" }
  | { status: "ignored"; why: "before_question" | "rate_limited" | "not_an_answer" | "no_question" }
  | { status: "wrong" }
  | { status: "won"; rewardPep: number; paid: boolean }
  | { status: "not_won"; why: "not_member" | "too_young" | "daily_cap" | "late" | "closed" | "attempts_exhausted" }
  | { status: "duplicate" };

export interface AnswerDeps extends PostDeps {
  now(): Date;
  isMember(discordId: string): Promise<boolean>;
  /** The stored attempt for this message, if any (a recorder retry). Checked before anything else. */
  findAttempt(messageId: string): Promise<{ correct: boolean } | null>;
  /** True when this member already has an attempt in this round in the last 2 seconds (extras are ignored). */
  throttled(roundId: number, discordId: string, now: Date): Promise<boolean>;
  /** Run after the response (Next after()): replies are posted off the request path. */
  defer(fn: () => Promise<void>): void;
}

export const defaultAnswerDeps = (defer: (fn: () => Promise<void>) => void): AnswerDeps => ({
  ...defaultPostDeps,
  now: () => new Date(),
  isMember: async (id) => !!(await fetchMemberIdByDiscordId(id)),
  findAttempt: findAttemptByMessage,
  throttled: (roundId, id, now) => hasRecentAttempt(roundId, id, now),
  defer,
});

/** Account age rule: the snowflake carries the creation date. */
export function accountOldEnough(discordId: string, now: Date): boolean {
  const created = snowflakeMs(discordId);
  return Number.isFinite(created) && now.getTime() - created >= MIN_ACCOUNT_AGE_DAYS * 24 * 60 * 60 * 1000;
}

/** The caller has already checked that trivia is live. Never throws for bad input (it is `ignored`). */
export async function processAnswer(input: AnswerInput, deps: AnswerDeps): Promise<AnswerOutcome> {
  const now = deps.now();
  const round = await findOpenRound(input.channelId, now);
  if (!round) return { status: "no_round" };

  // Only messages after the question count: after the bot's post when we know its id, else after the round opened.
  if (round.messageId ? !snowflakeAfter(input.messageId, round.messageId) : snowflakeMs(input.messageId) < round.openedAt.getTime()) {
    return { status: "ignored", why: "before_question" };
  }

  const question = getQuestion(round.questionId);
  if (!question) return { status: "ignored", why: "no_question" };

  // A retry of a message already recorded (the recorder retries after a 5xx) is answered from the store, before any
  // limit: the 2 s throttle below counts recorded attempts, so a retry can never be throttled by its own first try.
  if (await deps.findAttempt(input.messageId)) return { status: "duplicate" };

  // Chatter that is not an answer is ignored and never recorded. Discord rounds accept only explicit true/false tokens.
  const verdict = match(question, input.content, { strictBoolean: true }).verdict;
  if (verdict === "ignore") return { status: "ignored", why: "not_an_answer" };
  if (await deps.throttled(round.id, input.discordId, now)) return { status: "ignored", why: "rate_limited" };

  const correct = verdict === "correct";
  let eligibility: Eligibility = { ok: true };
  if (correct) {
    if (!accountOldEnough(input.discordId, now)) eligibility = { ok: false, reason: "too_young" };
    else if (REQUIRE_MEMBER && !(await deps.isMember(input.discordId))) eligibility = { ok: false, reason: "not_member" };
  }

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

  return finish(result, input, round, deps);
}

function finish(
  result: ClaimResult,
  input: AnswerInput,
  round: { id: number; channelId: string | null; questionId: string },
  deps: AnswerDeps,
): AnswerOutcome {
  switch (result.kind) {
    case "won":
      deps.defer(() =>
        announceWin(round, { discordId: input.discordId, messageId: input.messageId, rewardPep: result.rewardPep, paid: result.paid }, deps),
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
