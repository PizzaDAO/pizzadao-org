/**
 * Group scored members by map city and by country, apply the privacy minimums, pick the tier and
 * bucket the count (pure). The public payload is built field by field from whitelisted values:
 * raw scores, sums, names, ids and raw City text never reach it.
 *
 * The minimum counts distinct members with a Discord id (the scored ones), so a place cannot reach it
 * on rows that carry no score. Members without a Discord id only add to the displayed count bucket.
 */
import { countryName, ISO_NUMERIC } from './countries'
import type { MapCity, MapLevelsConfig, PublicMapLevels, ScoredMember, Tier } from './types'

/** The 1-based tier level for a summed score; 0 when the tier list is empty. */
export function tierLevel(score: number, tiers: readonly Tier[], kind: 'city' | 'country'): number {
  let level = 0
  tiers.forEach((t, i) => {
    if (score >= (kind === 'city' ? t.cityMin : t.countryMin)) level = i + 1
  })
  return level
}

/** The largest bucket at or below the count, shown as "10+"; null when the count is below every bucket. */
export function bucketCount(n: number, buckets: readonly number[]): string | null {
  let best: number | null = null
  for (const b of buckets) if (b <= n && (best === null || b > best)) best = b
  return best === null ? null : `${best}+`
}

export interface GroupStats {
  /** Distinct members with a Discord id (these carry a score). */
  scored: number
  /** Members with no Discord id. */
  unscored: number
  score: number
}

/** Per map city key and per country: member counts and the summed score. A Discord id counts once per place. */
export function groupMembers(members: readonly ScoredMember[]): { byCity: Map<string, GroupStats>; byCountry: Map<string, GroupStats> } {
  const byCity = new Map<string, GroupStats>()
  const byCountry = new Map<string, GroupStats>()
  const seen = new Map<Map<string, GroupStats>, Map<string, Set<string>>>()
  const add = (m: Map<string, GroupStats>, k: string, member: ScoredMember) => {
    const g = m.get(k) ?? { scored: 0, unscored: 0, score: 0 }
    m.set(k, g)
    if (member.discordId) {
      const perMap = seen.get(m) ?? new Map<string, Set<string>>()
      seen.set(m, perMap)
      const ids = perMap.get(k) ?? new Set<string>()
      perMap.set(k, ids)
      if (ids.has(member.discordId)) return
      ids.add(member.discordId)
      g.scored += 1
      g.score += member.score
    } else {
      g.unscored += 1
    }
  }
  for (const m of members) {
    if (m.place.kind === 'unplaced') continue
    if (m.place.kind === 'city') add(byCity, m.place.key, m)
    add(byCountry, m.place.country, m)
  }
  return { byCity, byCountry }
}

export const groupSize = (g: GroupStats) => g.scored + g.unscored

export function buildPublicPayload(
  members: readonly ScoredMember[],
  cities: readonly MapCity[],
  cfg: MapLevelsConfig,
  now: Date = new Date(),
): PublicMapLevels {
  const { byCity, byCountry } = groupMembers(members)

  const out: PublicMapLevels = {
    version: 1,
    generatedAt: now.toISOString(),
    tiers: cfg.tiers.map((t, i) => ({ level: i + 1, name: t.name })),
    cities: [],
    countries: [],
  }

  for (const c of [...cities].sort((a, b) => a.key.localeCompare(b.key))) {
    const g = byCity.get(c.key)
    // Below the minimum a place is left out entirely (its count is not published either).
    if (!g || g.scored < cfg.minMembersCity) continue
    const level = tierLevel(g.score, cfg.tiers, 'city')
    if (level < 1) continue
    const count = bucketCount(groupSize(g), cfg.buckets)
    out.cities.push({ key: c.key, name: c.name, country: c.country, level, ...(count ? { members: count } : {}) })
  }

  for (const iso2 of [...byCountry.keys()].sort()) {
    const g = byCountry.get(iso2)!
    const isoNumeric = ISO_NUMERIC[iso2]
    if (!isoNumeric || g.scored < cfg.minMembersCountry) continue
    const level = tierLevel(g.score, cfg.tiers, 'country')
    if (level < 1) continue
    const count = bucketCount(groupSize(g), cfg.buckets)
    out.countries.push({ iso2, isoNumeric, name: countryName(iso2), level, ...(count ? { members: count } : {}) })
  }
  return out
}
