/**
 * Admin preview of the map levels (pure). Unlike the public payload this shows raw numbers (summed
 * scores, exact counts) and the raw City values members typed, so it is only ever served by the
 * admin-gated route (app/api/admin/map-levels/preview). Never import this from a public route.
 */
import { countryName } from './countries'
import { buildPublicPayload, groupMembers, groupSize, tierLevel } from './aggregate'
import type { MapCity, MapLevelsConfig, PlaceResult, PublicMapLevels, ScoredMember } from './types'

export interface PreviewRow {
  /** Normalised City text as typed (admin only). */
  raw: string
  place: PlaceResult
  discordId: string
  score: number
}

interface PlaceLine {
  members: number
  scored: number
  score: number
  level: number
  tier: string
  passes: boolean
}

export interface AdminPreview {
  totals: { members: number; inCity: number; countryOnly: number; unplaced: number; mapCities: number; mapCitiesSynced: string }
  tiers: string[]
  cities: Array<PlaceLine & { key: string; name: string; country: string }>
  mapCitiesWithoutMembers: number
  countries: Array<PlaceLine & { iso2: string; name: string }>
  /** Raw City values that did not land in a map city: country only, or nowhere. For the alias table. */
  unmatched: Array<{ value: string; count: number; outcome: string }>
  public: PublicMapLevels
}

const MAX_UNMATCHED = 400

export function buildAdminPreview(
  rows: readonly PreviewRow[],
  cities: readonly MapCity[],
  cfg: MapLevelsConfig,
  syncedAt: string,
  now: Date = new Date(),
): AdminPreview {
  const placed: ScoredMember[] = rows
    .filter((r) => r.place.kind !== 'unplaced')
    .map((r) => ({ place: r.place, score: r.score, discordId: r.discordId || undefined }))
  const { byCity, byCountry } = groupMembers(placed)
  const tierName = (level: number) => cfg.tiers[level - 1]?.name ?? '-'
  const line = (g: { scored: number; unscored: number; score: number }, kind: 'city' | 'country', min: number): PlaceLine => {
    const level = tierLevel(g.score, cfg.tiers, kind)
    return { members: groupSize(g), scored: g.scored, score: Math.round(g.score), level, tier: tierName(level), passes: g.scored >= min }
  }

  const cityLines = cities
    .filter((c) => byCity.has(c.key))
    .map((c) => ({ key: c.key, name: c.name, country: c.country, ...line(byCity.get(c.key)!, 'city', cfg.minMembersCity) }))
    .sort((a, b) => b.score - a.score)
  const countryLines = [...byCountry.entries()]
    .map(([iso2, g]) => ({ iso2, name: countryName(iso2), ...line(g, 'country', cfg.minMembersCountry) }))
    .sort((a, b) => b.score - a.score)

  const counts = new Map<string, { count: number; outcome: string }>()
  for (const r of rows) {
    if (r.place.kind === 'city') continue
    const outcome = r.place.kind === 'countryOnly' ? `country only (${r.place.country})` : r.raw ? 'no place found' : 'empty'
    const key = `${r.raw}\u0000${outcome}`
    const cur = counts.get(key)
    if (cur) cur.count += 1
    else counts.set(key, { count: 1, outcome })
  }
  const unmatched = [...counts.entries()]
    .map(([k, v]) => ({ value: k.split('\u0000')[0], count: v.count, outcome: v.outcome }))
    .filter((u) => u.value)
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, MAX_UNMATCHED)

  return {
    totals: {
      members: rows.length,
      inCity: rows.filter((r) => r.place.kind === 'city').length,
      countryOnly: rows.filter((r) => r.place.kind === 'countryOnly').length,
      unplaced: rows.filter((r) => r.place.kind === 'unplaced').length,
      mapCities: cities.length,
      mapCitiesSynced: syncedAt,
    },
    tiers: cfg.tiers.map((t) => t.name),
    cities: cityLines,
    mapCitiesWithoutMembers: cities.length - cityLines.length,
    countries: countryLines,
    unmatched,
    public: buildPublicPayload(placed, cities, cfg, now),
  }
}
