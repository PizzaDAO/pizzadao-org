// app/lib/trivia/schedule.ts
//
// Pure scheduling and question picking for the Discord loop (plans/trivia.md section 6). No I/O.
//
// Slots: for each UTC day the schedule has `roundsPerDay` instants, each at a random minute inside one of the
// evening windows. "Random" is seeded by the date, so every cron tick on the same day computes the same slots
// (reruns are stable). The cron fires a slot that is due (<= now), not older than the catch-up limit, and not
// already fired (a round was opened at or after it), so a missed 5-minute tick is caught up by the next one.
import { SLOT_CATCH_UP_MINUTES, WINDOWS_UTC, DIFFICULTY_WEIGHTS } from "./config";
import { dayStartMs, hash32 } from "./daily";
import type { TriviaQuestion } from "./schema";

const MIN_MS = 60_000;

/** "14:00-16:00" -> start minute of day and length in minutes (a window may wrap past midnight). */
export function parseWindow(w: string): { startMin: number; lengthMin: number } | null {
  const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(w);
  if (!m) return null;
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  if (start > 24 * 60 || end > 24 * 60) return null;
  const length = (end - start + 24 * 60) % (24 * 60);
  return length > 0 ? { startMin: start, lengthMin: length } : null;
}

/** The slot instants (ms) of one schedule day, ascending. Deterministic for (dayKey, roundsPerDay). */
export function slotsForDay(dayKey: string, roundsPerDay: number, windows: readonly string[] = WINDOWS_UTC): number[] {
  const parsed = windows.map(parseWindow).filter((w): w is { startMin: number; lengthMin: number } => !!w);
  if (parsed.length === 0 || roundsPerDay < 1) return [];
  const base = dayStartMs(dayKey);
  // Day-seeded order of the windows, so a 1- or 2-round day does not always use the same windows.
  const order = parsed.map((_, i) => i).sort((a, b) => hash32(`${dayKey}:w:${a}`) - hash32(`${dayKey}:w:${b}`) || a - b);
  const slots: number[] = [];
  for (let i = 0; i < roundsPerDay; i++) {
    const w = parsed[order[i % order.length]];
    const offset = hash32(`${dayKey}:s:${i}`) % w.lengthMin;
    slots.push(base + (w.startMin + offset) * MIN_MS);
  }
  return slots.sort((a, b) => a - b);
}

export interface SlotRound {
  openedMs: number;
  /** The question post failed and the round was cancelled: this opening did not really fire the slot. */
  postFailed?: boolean;
}

/** A slot whose question post failed is retried once, then given up for that slot. */
export const MAX_POST_FAILURES_PER_SLOT = 2;

/**
 * The slot that should fire now, or null. `rounds` are recent Discord rounds (any status, manual ones and
 * /trivia skip included): a slot is fired once a round was opened at or after it. The exception is a round that
 * was cancelled because the question post failed: it does not fire the slot, but a second such failure does (at
 * most one retry per slot). Only the latest due slot counts, so a long outage posts one round, not a burst.
 */
export function dueSlot(now: Date, roundsPerDay: number, rounds: readonly SlotRound[], windows: readonly string[] = WINDOWS_UTC): number | null {
  const nowMs = now.getTime();
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(dayStartMs(today) - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const slots = [...slotsForDay(yesterday, roundsPerDay, windows), ...slotsForDay(today, roundsPerDay, windows)];
  const due = slots.filter((s) => s <= nowMs && nowMs - s <= SLOT_CATCH_UP_MINUTES * MIN_MS);
  if (due.length === 0) return null;
  const latest = Math.max(...due);
  const since = rounds.filter((r) => r.openedMs >= latest);
  if (since.some((r) => !r.postFailed)) return null;
  return since.length >= MAX_POST_FAILURES_PER_SLOT ? null : latest;
}

export interface PickOptions {
  /** Question ids used in recent Discord rounds, newest first. */
  recentIds: readonly string[];
  rng?: () => number;
}

/**
 * Random question from the (already filtered: discord pool, approved, not disabled) pool: avoids the last
 * floor(pool x 0.8) ids, weighted 40% easy, 45% medium, 15% hard. fun-* / just-for-fun questions are never
 * picked here, whatever the pool says (they are web only; the schema enforces it too).
 */
export function pickQuestion(pool: readonly TriviaQuestion[], { recentIds, rng = Math.random }: PickOptions): TriviaQuestion | null {
  const paid = pool.filter((q) => !q.id.startsWith("fun-") && q.category !== "just-for-fun");
  if (paid.length === 0) return null;
  const avoid = new Set(recentIds.slice(0, Math.floor(paid.length * 0.8)));
  let candidates = paid.filter((q) => !avoid.has(q.id));
  if (candidates.length === 0) candidates = [...paid]; // tiny pool: repeats beat silence
  const present = (Object.keys(DIFFICULTY_WEIGHTS) as (keyof typeof DIFFICULTY_WEIGHTS)[]).filter((d) => candidates.some((q) => q.difficulty === d));
  const total = present.reduce((sum, d) => sum + DIFFICULTY_WEIGHTS[d], 0);
  let roll = rng() * total;
  let difficulty = present[present.length - 1];
  for (const d of present) {
    roll -= DIFFICULTY_WEIGHTS[d];
    if (roll < 0) {
      difficulty = d;
      break;
    }
  }
  const tier = candidates.filter((q) => q.difficulty === difficulty);
  return tier[Math.min(tier.length - 1, Math.floor(rng() * tier.length))];
}
