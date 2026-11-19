// app/lib/trivia/config.ts
//
// The fixed launch rules of the Discord loop (plans/trivia.md section 6 and 13). These are decisions, not
// settings: the settings group (app/lib/settings/trivia-settings.ts) only carries the switches and the
// few knobs Snax may turn (enabled, dryRun, rewardPep, channelId, roundsPerDay).
import type { TriviaQuestion } from "./schema";

/** Rounds stay open this long, then the answer is revealed. */
export const ROUND_MINUTES = 10;
/** A member can win at most this many Discord rounds per UTC day; a 4th correct answer does not win (the round stays open). */
export const MAX_WINS_PER_USER_PER_DAY = 3;
/** Only onboarded members can win $PEP. */
export const REQUIRE_MEMBER = true;
/** The Discord account must be at least this old to win. */
export const MIN_ACCOUNT_AGE_DAYS = 7;
/** Evening windows (UTC) the schedule spreads rounds over: US, EU, Asia. "23:00-01:00" wraps past midnight. */
export const WINDOWS_UTC = ["14:00-16:00", "18:00-20:00", "23:00-01:00"] as const;
/** A slot that is more than this late (an outage) is skipped instead of firing hours after its time. */
export const SLOT_CATCH_UP_MINUTES = 90;
/** An expired round older than this is closed silently (no reveal) when the loop is switched back on. */
export const STALE_REVEAL_MINUTES = 30;
/** How many recent Discord rounds the question picker looks back at, at most. */
export const RECENT_ROUNDS_LOOKBACK = 400;
/** Difficulty weights for picking a question (plans/trivia.md section 6). */
export const DIFFICULTY_WEIGHTS = { easy: 40, medium: 45, hard: 15 } as const;

/** Attempts one member gets per round: true/false and multiple choice one (otherwise free money), short answers three. */
export function attemptsPerRound(q: Pick<TriviaQuestion, "type">): number {
  return q.type === "short_answer" ? 3 : 1;
}

/** Discord epoch (2015-01-01) in ms, for turning a snowflake into its creation time. */
const DISCORD_EPOCH_MS = 1420070400000;

/** When a Discord snowflake (account, message, channel) was created, in ms. NaN for a malformed id. */
export function snowflakeMs(id: string): number {
  if (!/^\d{5,25}$/.test(id)) return NaN;
  try {
    // The top bits are milliseconds since the Discord epoch; divide instead of shifting so no BigInt literal is needed.
    return Math.floor(Number(BigInt(id) / BigInt(4194304))) + DISCORD_EPOCH_MS;
  } catch {
    return NaN;
  }
}

/** True when `a` is a later snowflake than `b` (numeric compare; ids can exceed 2^53). */
export function snowflakeAfter(a: string, b: string): boolean {
  try {
    return BigInt(a) > BigInt(b);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Reaction answers (plans/trivia.md section 17)
// ---------------------------------------------------------------------------------------------------------------

/**
 * The server's custom turtle emoji, in theme-song order: choice A = Leonardo, B = Donatello, C = Raphael, D = Michelangelo.
 * The single place the mapping lives. Rendered as `<:name:id>`; added as a reaction as `name:id`.
 */
export const CHOICE_EMOJI = [
  { name: "1_leonardo", id: "814002498066710559" },
  { name: "1_donatello", id: "814002525736796211" },
  { name: "1_raphael", id: "814002564743692289" },
  { name: "1_michelangelo", id: "814002543046688775" },
] as const;

/** Used for a round when any turtle emoji is missing from the server (deleted, or the guild cannot be read). */
export const CHOICE_FALLBACK = ["\u{1F1E6}", "\u{1F1E7}", "\u{1F1E8}", "\u{1F1E9}"] as const; // regional indicators A B C D

/** True/false reactions: the post pre-adds these two. */
export const TF_REACTIONS = { true: "\u2705", false: "\u274C" } as const;

/** Pause between the bot's pre-added reactions (Discord rate-limits reaction adds to about 4 per second). */
export const REACTION_PACE_MS = 350;

/** The attempt key of a reaction answer: the first reaction of a member on a question message is their only attempt. */
export function reactionAttemptKey(questionMessageId: string, userId: string): string {
  return `reaction:${questionMessageId}:${userId}`;
}

/** Added to a member's own message when a short-answer attempt is graded wrong (never for true/false or multiple choice). */
export const WRONG_ATTEMPT_REACTION = "\u274C";
/** Added after the wrong mark when it was the member's last allowed try. */
export const OUT_OF_TRIES_REACTION = "\u{1F512}";

/** 🚩: the flag reaction the bot pre-adds, last, to every question post. A member's flag is a report, never an answer. */
export const FLAG_REACTION = "\u{1F6A9}";
/** 👀: the bot's acknowledgement on a reply that was recorded as a report. */
export const ACK_REACTION = "\u{1F440}";

/** Account age rule: the snowflake carries the creation date; the account must be at least MIN_ACCOUNT_AGE_DAYS old. */
export function accountOldEnough(discordId: string, now: Date): boolean {
  const created = snowflakeMs(discordId);
  return Number.isFinite(created) && now.getTime() - created >= MIN_ACCOUNT_AGE_DAYS * 24 * 60 * 60 * 1000;
}
