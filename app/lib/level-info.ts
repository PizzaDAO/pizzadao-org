/**
 * A member's level and what the next one needs, for the Discord /level command and the dashboard
 * level card. The pure builder takes the already-loaded rows so it is testable without a database.
 * "Needs" = the missions of the member's current level: finishing every one of them is what moves
 * them up (see computeCurrentLevel in missions.ts). Mission rules are untouched.
 */
import { getCurrentLevel, getMissionsByLevel, getUserMissionProgress } from '@/app/lib/missions'

export type LevelMissionState = 'done' | 'pending' | 'todo'

export interface LevelMissionRow {
  id: number
  title: string
  state: LevelMissionState
}

export interface LevelInfo {
  level: number
  title: string | null
  /** Highest level with an active mission; level > maxLevel means MAX. */
  maxLevel: number
  isMax: boolean
  /** The current level's missions, in order, with the member's state for each. */
  missions: LevelMissionRow[]
  done: number
  total: number
  /** Title of the level after this one, if it has one. */
  nextTitle: string | null
}

type MissionLite = { id: number; level: number; index?: number; title: string; levelTitle: string | null }

export function buildLevelInfo(
  level: number,
  missions: readonly MissionLite[],
  progress: readonly { missionId: number; status: string }[],
): LevelInfo {
  const maxLevel = missions.reduce((max, m) => Math.max(max, m.level), 0)
  const byLevel = (l: number) => missions.filter((m) => m.level === l).sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  const status = new Map<number, string>()
  // APPROVED beats PENDING beats anything else, whatever order the rows come in.
  const rank = (s: string) => (s === 'APPROVED' ? 2 : s === 'PENDING' ? 1 : 0)
  for (const p of progress) if (rank(p.status) >= rank(status.get(p.missionId) ?? '')) status.set(p.missionId, p.status)
  const rows: LevelMissionRow[] = byLevel(level).map((m) => {
    const s = status.get(m.id)
    return { id: m.id, title: m.title, state: s === 'APPROVED' ? 'done' : s === 'PENDING' ? 'pending' : 'todo' }
  })
  const title = (l: number) => byLevel(l).find((m) => m.levelTitle)?.levelTitle ?? null
  return {
    level,
    title: title(level),
    maxLevel,
    isMax: level > maxLevel,
    missions: rows,
    done: rows.filter((r) => r.state === 'done').length,
    total: rows.length,
    nextTitle: level < maxLevel ? title(level + 1) : null,
  }
}

export async function getLevelInfo(discordId: string): Promise<LevelInfo> {
  const [level, grouped, progress] = await Promise.all([getCurrentLevel(discordId), getMissionsByLevel(), getUserMissionProgress(discordId)])
  // Level progress counts only the missions that gate a level (not bonus / Anytime ones).
  const missions = Object.values(grouped).flat().filter((m) => !m.bonus && m.level > 0) as MissionLite[]
  return buildLevelInfo(level, missions, progress.map((p) => ({ missionId: p.missionId, status: p.status })))
}
