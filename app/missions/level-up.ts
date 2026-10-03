// Which level-up (if any) the member has not been shown yet.
//
// `currentLevel` is "highest completed level + 1" and `lastCelebratedLevel`
// is stored in the same units (the level reached when the last celebration
// fired), so every level L with lastCelebratedLevel <= L < currentLevel was
// completed but never celebrated: e.g. approved by a reviewer while the
// member wasn't on the page. They are folded into ONE modal: the level
// reached, its title, and the PEP the newly completed levels paid.

export type LevelUpSnapshot = {
  levels: ReadonlyArray<{ level: number; title: string | null; reward: number }>;
  currentLevel: number;
  levelTitle: string | null;
};

export type LevelUp = {
  /** The level reached (same as currentLevel). */
  level: number;
  levelTitle: string | null;
  /** Total reward of the levels completed since the last celebration. */
  reward: number;
  /** The member is on (or past) the last level. */
  isFinal: boolean;
};

export function levelUpToCelebrate(snapshot: LevelUpSnapshot, lastCelebratedLevel: number): LevelUp | null {
  const { currentLevel, levels } = snapshot;
  if (currentLevel < 2) return null; // nothing completed yet
  if (currentLevel <= lastCelebratedLevel) return null; // already celebrated

  const from = Math.max(lastCelebratedLevel, 1);
  const reward = levels
    .filter((l) => l.level >= from && l.level < currentLevel)
    .reduce((sum, l) => sum + (Number.isFinite(l.reward) ? l.reward : 0), 0);
  const maxLevel = levels.reduce((max, l) => Math.max(max, l.level), 0);

  return {
    level: currentLevel,
    levelTitle: levels.find((l) => l.level === currentLevel)?.title ?? snapshot.levelTitle ?? null,
    reward,
    isFinal: maxLevel > 0 && currentLevel >= maxLevel,
  };
}
