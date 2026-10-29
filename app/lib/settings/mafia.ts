/**
 * Mafia points and ranks as settings (plans/app-settings.md, phase 5). Pure over an already-loaded
 * snapshot. Which sources exist (role ids, contract names, attendance split) stays in
 * app/lib/mafia-points/config.ts; settings only change how many points a source is worth and where
 * the rank tiers start. With no saved row the code tables apply unchanged.
 */
import { MAFIA_POINT_SOURCES, MAFIA_RANKS, type MafiaRank, type PointSource } from '@/app/lib/mafia-points/config'
import type { Settings } from './index'
import { storedOverride } from './numbers'

export interface SourcePoints {
  id: string
  points: number
}

/** The point sources with any saved per-source points applied (ids not saved keep the code value). */
export function mafiaSources(settings?: Settings): PointSource[] {
  const saved = storedOverride('mafia.sourcePoints', settings)
  if (!saved) return MAFIA_POINT_SOURCES
  const byId = new Map((saved.value as SourcePoints[]).map((r) => [r.id, r.points]))
  return MAFIA_POINT_SOURCES.map((s) => (byId.has(s.id) ? { ...s, points: byId.get(s.id)! } : s))
}

/** The rank tiers, highest first. */
export function mafiaRanks(settings?: Settings): MafiaRank[] {
  const saved = storedOverride('mafia.ranks', settings)
  if (!saved) return MAFIA_RANKS
  return [...(saved.value as MafiaRank[])].sort((a, b) => b.minPoints - a.minPoints)
}
