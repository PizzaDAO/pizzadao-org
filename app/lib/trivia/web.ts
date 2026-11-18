// app/lib/trivia/web.ts
//
// DB access for the web daily. plans/trivia.md §4.1, §8.
//
// Every function here tolerates the Trivia tables being absent (the migration is applied to production by hand before
// the merge, and previews share that database): a failed query is logged and reported as "no data", so the page still
// renders and practice still works. Nothing here posts to Discord or pays PEP (phase 2).
import { prisma } from "@/app/lib/db";
import { getQuestion, servable } from "./bank";
import { addDays, computeStreak, dailyQuestionFor, dayKeyUtc, nextDayStartMs } from "./daily";
import type { TriviaQuestion } from "./schema";

export interface DailyRound {
  dayKey: string;
  question: TriviaQuestion;
  /** Null when the tables are unavailable: the day's question is still computed, answers just aren't recorded. */
  roundId: number | null;
}

/** Today's web daily: the stored round if there is one, else computed (and stored, best effort). Null if the web pool is empty. */
export async function getDailyRound(now: Date = new Date()): Promise<DailyRound | null> {
  const dayKey = dayKeyUtc(now);
  const pool = servable({ now, pool: "web" });
  const computed = dailyQuestionFor(dayKey, pool);

  try {
    const existing = await prisma.triviaRound.findUnique({ where: { dayKey } });
    if (existing) {
      const stored = getQuestion(existing.questionId);
      // Keep the stored question unless it was pulled since (retired, disabled or no longer a web question).
      if (stored && pool.some((q) => q.id === stored.id)) return { dayKey, question: stored, roundId: existing.id };
      if (computed) return { dayKey, question: computed, roundId: existing.id };
      return null;
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

/** Current daily streak of one member (days with a recorded web attempt). 0 when unavailable. */
export async function streakFor(discordId: string, today: string): Promise<number> {
  try {
    const rows = await prisma.triviaAttempt.findMany({
      where: { discordId, messageId: null, round: { surface: "WEB_DAILY", dayKey: { gte: addDays(today, -400) } } },
      select: { round: { select: { dayKey: true } } },
      take: 500,
    });
    return computeStreak(
      rows.map((r) => r.round.dayKey).filter((k): k is string => !!k),
      today,
    );
  } catch {
    return 0;
  }
}
