/**
 * Member score for the reach-map levels (pure). Level is the main signal, missions add breadth, PEP
 * is damped (log, capped) so one wallet cannot carry a city. Rank in the mafia, vouches and activity
 * are not part of it.
 */
import type { MapLevelsConfig, MemberSignals } from './types'

type Weights = Pick<MapLevelsConfig, 'weightLevel' | 'weightMission' | 'missionCap' | 'weightPep' | 'pepCap' | 'scoreCap'>

export function memberScore(m: MemberSignals, c: Weights): number {
  // Members with no Discord account have no level, missions or PEP: they add nothing.
  if (!m.hasDiscord) return 0
  const completedLevels = Math.max(0, (Number.isFinite(m.level) ? m.level : 1) - 1)
  const missions = Math.min(Math.max(0, m.approvedMissions || 0), c.missionCap)
  const pep = Number.isFinite(m.pep) ? Math.min(Math.max(m.pep, 0), c.pepCap) : 0
  const raw = c.weightLevel * completedLevels + c.weightMission * missions + c.weightPep * Math.log10(1 + pep)
  return c.scoreCap > 0 ? Math.min(c.scoreCap, raw) : raw
}
