// app/lib/trivia/daily.ts
//
// Pure helpers for the web daily and practice (no I/O). plans/trivia.md §8.
//
// The daily is the same question for everyone for a UTC day. It is picked deterministically from the *web* pool:
// the pool is put in a fixed pseudo-random order (by a hash of each id) and the day number walks through it, so
// every question comes up once before any repeats and no two nearby days feel alike. The result is also written
// to a TriviaRound row (see web.ts) the first time the day is seen, so editing the bank mid-day cannot change it.
import type { TriviaCategory, TriviaQuestion } from "./schema";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 'YYYY-MM-DD' in UTC. */
export function dayKeyUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Midnight UTC that starts the given day key. NaN-safe: a bad key gives 0. */
export function dayStartMs(dayKey: string): number {
  const ms = Date.parse(`${dayKey}T00:00:00Z`);
  return Number.isNaN(ms) ? 0 : ms;
}

/** When the daily rolls over (the start of the next UTC day). */
export function nextDayStartMs(dayKey: string): number {
  return dayStartMs(dayKey) + DAY_MS;
}

export function addDays(dayKey: string, days: number): string {
  return dayKeyUtc(new Date(dayStartMs(dayKey) + days * DAY_MS));
}

/** FNV-1a, 32 bit. Stable across runtimes, which is all the daily needs. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The question for a day: the pool in a fixed hash order, indexed by the day number. Null for an empty pool. */
export function dailyQuestionFor(dayKey: string, pool: TriviaQuestion[]): TriviaQuestion | null {
  if (pool.length === 0) return null;
  const ordered = [...pool].sort((a, b) => hash32(`daily:${a.id}`) - hash32(`daily:${b.id}`) || a.id.localeCompare(b.id));
  const dayNumber = Math.floor(dayStartMs(dayKey) / DAY_MS);
  return ordered[((dayNumber % ordered.length) + ordered.length) % ordered.length];
}

/**
 * The current daily streak: consecutive UTC days, ending today (or yesterday, if today is not played yet), on which
 * the member answered the daily. A day counts once played, right or wrong: the streak rewards showing up.
 */
export function computeStreak(playedDayKeys: Iterable<string>, today: string): number {
  const played = new Set(playedDayKeys);
  let cursor = played.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (played.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export interface PracticeOptions {
  category?: TriviaCategory | null;
  count?: number;
  rng?: () => number;
}

/** A random sample (no repeats) of the pool, optionally one category. */
export function pickPractice(pool: TriviaQuestion[], { category = null, count = 10, rng = Math.random }: PracticeOptions = {}): TriviaQuestion[] {
  const from = category ? pool.filter((q) => q.category === category) : [...pool];
  for (let i = from.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [from[i], from[j]] = [from[j], from[i]];
  }
  return from.slice(0, Math.max(0, Math.min(count, 10)));
}

/** Categories present in the pool with their question counts, in a stable order. */
export function categoryCounts(pool: TriviaQuestion[]): { id: TriviaCategory; count: number }[] {
  const counts = new Map<TriviaCategory, number>();
  for (const q of pool) counts.set(q.category, (counts.get(q.category) ?? 0) + 1);
  return [...counts.entries()].map(([id, count]) => ({ id, count })).sort((a, b) => a.id.localeCompare(b.id));
}
