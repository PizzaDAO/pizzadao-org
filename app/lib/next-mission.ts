import type { MissionsOverview } from "@/app/lib/missions-overview";

export type NextMission = { level: number; id: number; title: string };

/**
 * The member's next mission: the first mission at or above their current level
 * that they haven't submitted (or whose submission was rejected).
 */
export function pickNextMission(overview: Pick<MissionsOverview, "levels" | "currentLevel">): NextMission | null {
  const levels = [...overview.levels].sort((a, b) => a.level - b.level);
  for (const lvl of levels) {
    if (lvl.level < overview.currentLevel) continue;
    const m = [...lvl.missions]
      .sort((a, b) => a.index - b.index)
      .find((x) => !x.progress || x.progress.status === "REJECTED");
    if (m) return { level: lvl.level, id: m.id, title: m.title };
  }
  return null;
}
