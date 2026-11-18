/**
 * Display helpers for member levels. `getCurrentLevel` / `computeCurrentLevel` return the level a
 * member is WORKING ON (highest completed + 1) and gate things on it (missions, PFP unlocks,
 * payouts). Badges and labels show the highest level COMPLETED instead: use these helpers in
 * display code only, never to gate anything.
 */

/** The highest level completed, given the working-on level. 0 means nothing completed yet. */
export function completedLevel(current: number): number {
  return Math.max(0, Math.floor(current) - 1)
}

/** The title of `level` from rows that carry a levelTitle, or null (also for level 0). */
export function titleForLevel(
  rows: ReadonlyArray<{ level: number; levelTitle?: string | null }>,
  level: number,
): string | null {
  if (level < 1) return null
  return rows.find((r) => r.level === level && r.levelTitle)?.levelTitle ?? null
}
