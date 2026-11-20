// app/lib/trivia/web.ts
//
// DB access for the web daily. plans/trivia.md §4.1, §8.
//
// Every function here tolerates the Trivia tables being absent (the migration is applied to production by hand before
// the merge, and previews share that database): a failed query is logged and reported as "no data", so the page still
// renders and practice still works. Nothing here posts to Discord; the only PEP paid is the optional web daily reward (payDailyReward).
import { prisma } from "@/app/lib/db";
import { creditInTx, getOrCreateEconomy } from "@/app/lib/economy";
import { fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";
import { triviaSettings } from "./channel";
import { accountOldEnough, REQUIRE_MEMBER } from "./config";
import { triviaLive } from "./enabled";
import { filterServable, getBank } from "./bank";
import { addDays, computeBestStreak, computeStreak, dayKeyUtc, nextDayStartMs } from "./daily";
import { pickDailyQuestion } from "./exposed";
import { getDisabledIds } from "./reports";
import type { TriviaQuestion } from "./schema";

export interface DailyRound {
  dayKey: string;
  question: TriviaQuestion;
  /** Null when the tables are unavailable: the day's question is still computed, answers just aren't recorded. */
  roundId: number | null;
}

/**
 * Today's web daily: the stored round if there is one, else computed (and stored, best effort). Null if the web pool is empty.
 *
 * If the stored question is no longer servable (retired, expired, or no longer a web question; NOT merely pulled: see below) the round is re-pointed at the
 * replacement and the answers already given to the pulled question are voided (deleted): they were graded against a
 * question that is no longer served, so keeping them would make the reveal, "% got it right" and streak disagree with
 * the question on screen. Those members can answer the replacement and win the day back.
 */
/** Question ids of the web dailies before `dayKey`, newest first; cached per day (past days do not change). */
let recentDailyCache: { dayKey: string; ids: string[] } | null = null;
async function recentDailyIds(dayKey: string): Promise<string[]> {
  if (recentDailyCache?.dayKey === dayKey) return recentDailyCache.ids;
  try {
    const rows: { questionId: string }[] = await prisma.triviaRound.findMany({
      where: { surface: "WEB_DAILY", dayKey: { lt: dayKey } },
      orderBy: { dayKey: "desc" },
      take: 200,
      select: { questionId: true },
    });
    const ids = rows.map((r) => r.questionId);
    recentDailyCache = { dayKey, ids };
    return ids;
  } catch {
    return [];
  }
}

/**
 * The web pool for today and the question the day computes from it: the web pool minus pulled questions, preferring
 * unexposed questions (exposed.ts pickDailyQuestion; the recent dailies are only read while exposed ones are left).
 * `stillServable` ignores pulls: see getDailyRound.
 */
async function dailyContext(now: Date): Promise<{ dayKey: string; pool: TriviaQuestion[]; computed: TriviaQuestion | null; stillServable: TriviaQuestion[] }> {
  const dayKey = dayKeyUtc(now);
  const bank = await getBank();
  const pool = filterServable(bank.questions, { now, pool: "web", disabledIds: await getDisabledIds() });
  const anyExposed = pool.some((q) => bank.exposedIds.has(q.id));
  const computed = pickDailyQuestion(dayKey, pool, { exposedIds: bank.exposedIds, recentIds: anyExposed ? await recentDailyIds(dayKey) : [] });
  return { dayKey, pool, computed, stillServable: filterServable(bank.questions, { now, pool: "web" }) };
}

export async function getDailyRound(now: Date = new Date()): Promise<DailyRound | null> {
  // Today's stored question stays valid even if it has been PULLED (disabled) since: a pull stops it being picked from
  // tomorrow, but never changes the question on screen mid-day or deletes anyone's answer and streak credit. Only a
  // question that is no longer servable at all (retired, expired, moved out of the web pool) is re-pointed.
  // An empty or unreachable bank computes nothing and changes nothing: no round is stored or re-pointed (bank.ts logs it).
  const { dayKey, computed, stillServable } = await dailyContext(now);

  try {
    const existing = await prisma.triviaRound.findUnique({ where: { dayKey } });
    if (existing) {
      const stored = stillServable.find((q) => q.id === existing.questionId);
      if (stored && stillServable.some((q) => q.id === stored.id)) return { dayKey, question: stored, roundId: existing.id };
      if (!computed) return null;
      await prisma.$transaction([
        prisma.triviaAttempt.deleteMany({ where: { roundId: existing.id } }),
        prisma.triviaRound.update({ where: { id: existing.id }, data: { questionId: computed.id } }),
      ]);
      return { dayKey, question: computed, roundId: existing.id };
    }
    if (!computed) return null;
    try {
      const created = await prisma.triviaRound.create({
        data: { surface: "WEB_DAILY", questionId: computed.id, status: "OPEN", dayKey, closesAt: new Date(nextDayStartMs(dayKey)) },
      });
      return { dayKey, question: computed, roundId: created.id };
    } catch {
      // Lost a race with another request creating the same day.
      const again = await prisma.triviaRound.findUnique({ where: { dayKey } });
      return { dayKey, question: computed, roundId: again?.id ?? null };
    }
  } catch (e) {
    console.error("[trivia] daily round unavailable:", (e as Error).message);
    return computed ? { dayKey, question: computed, roundId: null } : null;
  }
}

/**
 * The questions practice may serve: the web pool minus today's daily, so a practice reveal can never give away the
 * daily answer before a member's recorded attempt.
 */
export async function practicePool(now: Date = new Date()): Promise<TriviaQuestion[]> {
  const { pool, computed } = await dailyContext(now);
  const daily = await getDailyRound(now);
  const hidden = new Set([daily?.question.id, computed?.id].filter((x): x is string => !!x));
  return pool.filter((q) => !hidden.has(q.id));
}

export interface StoredAttempt {
  correct: boolean;
}

export async function findDailyAttempt(roundId: number, discordId: string): Promise<StoredAttempt | null> {
  try {
    const a = await prisma.triviaAttempt.findFirst({ where: { roundId, discordId, messageId: null }, select: { correct: true } });
    return a ? { correct: a.correct } : null;
  } catch (e) {
    console.error("[trivia] attempt lookup failed:", (e as Error).message);
    return null;
  }
}

/** Record the one web attempt for the day. Returns false if there already is one (or the write failed). */
export async function recordDailyAttempt(roundId: number, discordId: string, correct: boolean, answerText: string): Promise<boolean> {
  try {
    await prisma.triviaAttempt.create({
      data: { roundId, discordId, messageId: null, correct, answerText: answerText.slice(0, 120) },
    });
    return true;
  } catch (e) {
    // The partial unique index (roundId, discordId) WHERE messageId IS NULL turns a double submit into a conflict.
    console.error("[trivia] attempt not recorded:", (e as Error).message);
    return false;
  }
}

/** Share of recorded players who got the day's question right, or null while there are too few to say. */
export async function percentCorrect(roundId: number, minPlayers = 5): Promise<number | null> {
  try {
    const [total, right] = await Promise.all([
      prisma.triviaAttempt.count({ where: { roundId, messageId: null } }),
      prisma.triviaAttempt.count({ where: { roundId, messageId: null, correct: true } }),
    ]);
    return total >= minPlayers ? Math.round((right / total) * 100) : null;
  } catch {
    return null;
  }
}

export interface StreakStats {
  /** Consecutive days ending today (or yesterday while today is not played): the number the leaderboard ranks. */
  current: number;
  /** Longest run in the last STREAK_HISTORY_DAYS days. Never below `current`. */
  best: number;
  /** The member has already played today's daily (so `current` includes today). */
  playedToday: boolean;
}

/** How far back the best streak looks. */
export const STREAK_HISTORY_DAYS = 400;

/**
 * Current and best daily streak of one member (days with a recorded web attempt). The current streak is computed with
 * computeStreak, exactly as the leaderboard does, so the number here is the number on the board (the board only stops
 * counting past its own 120-day window). All zeros when unavailable.
 */
export async function streakStatsFor(discordId: string, today: string): Promise<StreakStats> {
  try {
    const rows = await prisma.triviaAttempt.findMany({
      where: { discordId, messageId: null, round: { surface: "WEB_DAILY", dayKey: { gte: addDays(today, -STREAK_HISTORY_DAYS) } } },
      select: { round: { select: { dayKey: true } } },
      orderBy: { id: "asc" },
      take: 500,
    });
    const days = rows.map((r) => r.round.dayKey).filter((k): k is string => !!k);
    const current = computeStreak(days, today);
    return { current, best: Math.max(current, computeBestStreak(days)), playedToday: days.includes(today) };
  } catch {
    return { current: 0, best: 0, playedToday: false };
  }
}

/** Current daily streak of one member (days with a recorded web attempt). 0 when unavailable. */
export async function streakFor(discordId: string, today: string): Promise<number> {
  return (await streakStatsFor(discordId, today)).current;
}

// ---------------------------------------------------------------------------------------------------------------
// Web daily reward (trivia.webDailyRewardPep, default 0 = off)
// ---------------------------------------------------------------------------------------------------------------

/** Advisory-lock namespace for one member's web daily payout (first key of the two-key lock; see rounds.ts, reports.ts, suggestions.ts for the others). */
export const DAILY_REWARD_LOCK_NAMESPACE = 742019347;

export interface DailyReward {
  /** $PEP paid (status "paid") or on offer. 0 when off. */
  pep: number;
  status: "paid" | "ineligible" | "off" | "already" | "error";
  /** Why an ineligible member was not paid. */
  reason?: "not_member" | "too_young";
}

/** What a correct daily answer would pay right now, for the "Correct answer pays N" line. 0 when off, in dry run, or not live. */
export async function dailyRewardOffer(env: Record<string, string | undefined> = process.env): Promise<number> {
  try {
    const s = await triviaSettings(env);
    if (s.webDailyRewardPep <= 0 || s.dryRun || !(await triviaLive(env))) return 0;
    return s.webDailyRewardPep;
  } catch {
    return 0;
  }
}

/**
 * Pay the web daily reward for a member's recorded, correct attempt. Same eligibility as a Discord win (onboarded member,
 * Discord account at least 7 days old). Exactly once per member per day, enforced in the database: the attempt row (unique
 * per round and member) is checked, then a TriviaDailyReward row (unique per member and day, independent of attempt rows) is inserted under an advisory lock, and the wallet
 * credit and TRIVIA_DAILY_REWARD ledger row are written in that same transaction. It never counts toward the Discord
 * 3-wins-a-day cap (that counts WON Discord rounds). Never throws: any failure is logged and reported as "error".
 */
export async function payDailyReward(
  input: { roundId: number; dayKey: string; discordId: string },
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env,
): Promise<DailyReward> {
  try {
    const s = await triviaSettings(env);
    if (s.webDailyRewardPep <= 0 || !(await triviaLive(env))) return { pep: 0, status: "off" };
    const pep = s.webDailyRewardPep;
    if (s.dryRun) {
      console.info(`[trivia] dry run: would pay ${pep} $PEP for the web daily ${input.dayKey} to ${input.discordId}`);
      return { pep: 0, status: "off" };
    }
    if (!accountOldEnough(input.discordId, now)) return { pep, status: "ineligible", reason: "too_young" };
    if (REQUIRE_MEMBER && !(await fetchMemberIdByDiscordId(input.discordId))) return { pep, status: "ineligible", reason: "not_member" };

    await getOrCreateEconomy(input.discordId); // the wallet row must exist before the transaction
    const paid = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${DAILY_REWARD_LOCK_NAMESPACE}::int, hashtext(${`${input.dayKey}:${input.discordId}`}))`;
        // Only a recorded, correct attempt of this round earns it (a voided or wrong one does not).
        const mine = await tx.triviaAttempt.findFirst({ where: { roundId: input.roundId, discordId: input.discordId, messageId: null, correct: true }, select: { id: true } });
        if (!mine) return false;
        // The dedicated row is the exactly-once key (unique per member and day), independent of attempt rows, which a
        // re-pointed daily deletes. ON CONFLICT DO NOTHING (no aborted transaction): count 0 means already paid today.
        const claimed = await tx.triviaDailyReward.createMany({ data: [{ discordId: input.discordId, dayKey: input.dayKey, pep }], skipDuplicates: true });
        if (claimed.count !== 1) return false;
        await creditInTx(tx, input.discordId, pep, "TRIVIA_DAILY_REWARD", "Trivia web daily", { roundId: input.roundId, dayKey: input.dayKey });
        return true;
      },
      { maxWait: 15_000, timeout: 30_000 },
    );
    return { pep, status: paid ? "paid" : "already" };
  } catch (e) {
    console.error("[trivia] web daily reward failed:", (e as Error).message);
    return { pep: 0, status: "error" };
  }
}

/** True when a web daily reward is configured (setting above 0), whether or not it can be paid here (previews share the production question and database). */
export async function dailyRewardConfigured(env: Record<string, string | undefined> = process.env): Promise<boolean> {
  try {
    return (await triviaSettings(env)).webDailyRewardPep > 0;
  } catch {
    return false;
  }
}

/** Whether this member already has their reward row for the day (cheap check before retrying a payout). False when unavailable. */
export async function dailyRewardPaid(discordId: string, dayKey: string): Promise<boolean> {
  try {
    return !!(await prisma.triviaDailyReward.findUnique({ where: { discordId_dayKey: { discordId, dayKey } }, select: { id: true } }));
  } catch {
    return false;
  }
}
