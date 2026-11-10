/**
 * Group scored members by map city and by country, apply the privacy minimums, pick the tier and
 * bucket the count (pure). The public payload is built field by field from whitelisted values:
 * raw scores, sums, names, ids and raw City text never reach it.
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

interface Group {
  members: number
  score: number
}

export function buildPublicPayload(
  members: readonly ScoredMember[],
  cities: readonly MapCity[],
  cfg: MapLevelsConfig,
  now: Date = new Date(),
): PublicMapLevels {
  const byCity = new Map<string, Group>()
  const byCountry = new Map<string, Group>()
  const add = (m: Map<string, Group>, k: string, score: number) => {
    const g = m.get(k) ?? { members: 0, score: 0 }
    g.members += 1
    g.score += score
    m.set(k, g)
  }
  for (const m of members) {
    if (m.place.kind === 'unplaced') continue
    if (m.place.kind === 'city') add(byCity, m.place.key, m.score)
    add(byCountry, m.place.country, m.score)
  }

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
    if (!g || g.members < cfg.minMembersCity) continue
    const level = tierLevel(g.score, cfg.tiers, 'city')
    if (level < 1) continue
    const count = bucketCount(g.members, cfg.buckets)
    out.cities.push({ key: c.key, name: c.name, country: c.country, level, ...(count ? { members: count } : {}) })
  }

  for (const iso2 of [...byCountry.keys()].sort()) {
    const g = byCountry.get(iso2)!
    const isoNumeric = ISO_NUMERIC[iso2]
    if (!isoNumeric || g.members < cfg.minMembersCountry) continue
    const level = tierLevel(g.score, cfg.tiers, 'country')
    if (level < 1) continue
    const count = bucketCount(g.members, cfg.buckets)
    out.countries.push({ iso2, isoNumeric, name: countryName(iso2), level, ...(count ? { members: count } : {}) })
  }
  return out
}
