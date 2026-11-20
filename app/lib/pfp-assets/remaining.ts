// What a member still has to do to unlock the PFP editor, for the locked page: the required
// missions of the levels between their completed level and the required one that are not approved yet.
// Level rules stay in missions-overview (the same list as /missions); this only filters it.
import { getMissionsOverview } from '@/app/lib/missions-overview'

export interface RemainingMission {
  id: number
  title: string
  level: number
  /** The mission's own handbook page when it has one; the page falls back to /missions. */
  href?: string
}

export async function loadRemainingMissions(discordId: string, completed: number, minLevel: number): Promise<RemainingMission[]> {
  const overview = await getMissionsOverview(discordId)
  const out: RemainingMission[] = []
  for (const l of [...overview.levels].sort((a, b) => a.level - b.level)) {
    if (l.level < 1 || l.level <= completed || l.level > minLevel) continue
    for (const m of l.missions) {
      if (m.bonus || m.progress?.status === 'APPROVED') continue
      out.push({ id: m.id, title: m.title, level: l.level, ...(m.guideHref ? { href: m.guideHref } : {}) })
    }
  }
  return out
}
