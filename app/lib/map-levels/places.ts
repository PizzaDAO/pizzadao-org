/**
 * Turn a member's free-text City value into a place on the map (pure).
 *
 * Values mostly come from Google Places autocomplete ("City, State, Country"), the rest is free
 * text. Matching is deliberately conservative: no fuzzy matching. A value that cannot be matched
 * to a map city is left unplaced (or counted for its country only); admin aliases fix the rest.
 */
import { countryFromText, isIso2, normalizeText } from './countries'
import type { MapCity, PlaceAlias, PlaceResult } from './types'

/** The comma parts of a value, normalised, with empty parts dropped. */
export function placeParts(raw: string): string[] {
  return normalizeText(String(raw ?? ''))
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
}

/** The form an alias `match` is stored and compared in: the normalised parts joined by ", ". */
export function normalizeAliasMatch(raw: string): string {
  return placeParts(raw).join(', ')
}

/**
 * Common spellings of a map city's name (normalised first part -> map city key). These are facts,
 * not tunables: the obvious ones match without admin work. Keys that are not on the map are skipped.
 */
export const BUILTIN_CITY_NAMES: Readonly<Record<string, string>> = {
  'new york': 'new-york-city-840',
  nyc: 'new-york-city-840',
  manhattan: 'new-york-city-840',
  brooklyn: 'new-york-city-840',
  queens: 'new-york-city-840',
  bronx: 'new-york-city-840',
  'the bronx': 'new-york-city-840',
  'staten island': 'new-york-city-840',
  sf: 'san-francisco-840',
  'san fran': 'san-francisco-840',
  la: 'los-angeles-840',
  dc: 'washington-dc-840',
  washington: 'washington-dc-840',
  'washington dc': 'washington-dc-840',
  bombay: 'mumbai-356',
  bengaluru: 'bangalore-356',
  calcutta: 'kolkata-356',
  'new delhi': 'delhi-356',
  kiev: 'kyiv-804',
  saigon: 'ho-chi-minh-city-704',
  'ho chi minh': 'ho-chi-minh-city-704',
  cdmx: 'mexico-city-484',
  'ciudad de mexico': 'mexico-city-484',
  rio: 'rio-de-janeiro-076',
  'tel aviv-yafo': 'tel-aviv-376',
  munchen: 'munich-276',
  'frankfurt am main': 'frankfurt-276',
}

export interface PlaceIndex {
  cities: readonly MapCity[]
  byKey: Map<string, MapCity>
  byName: Map<string, MapCity[]>
  aliases: Map<string, string>
}

export function buildPlaceIndex(cities: readonly MapCity[], aliases: readonly PlaceAlias[]): PlaceIndex {
  const byKey = new Map<string, MapCity>()
  const byName = new Map<string, MapCity[]>()
  for (const c of cities) {
    byKey.set(c.key, c)
    const n = normalizeText(c.name)
    byName.set(n, [...(byName.get(n) ?? []), c])
  }
  for (const [name, key] of Object.entries(BUILTIN_CITY_NAMES)) {
    const c = byKey.get(key)
    if (c && !(byName.get(name) ?? []).some((x) => x.key === c.key)) byName.set(name, [...(byName.get(name) ?? []), c])
  }
  return { cities, byKey, byName, aliases: new Map(aliases.map((a) => [normalizeAliasMatch(a.match), a.target])) }
}

function fromTarget(target: string, idx: PlaceIndex): PlaceResult | null {
  if (target === 'ignore') return { kind: 'unplaced' }
  if (target.startsWith('country:')) {
    const code = target.slice(8).toUpperCase()
    return isIso2(code) ? { kind: 'countryOnly', country: code } : null
  }
  const city = idx.byKey.get(target)
  return city ? { kind: 'city', key: city.key, country: city.country } : null
}

export function resolvePlace(raw: string | null | undefined, idx: PlaceIndex): PlaceResult {
  const parts = placeParts(raw ?? '')
  if (parts.length === 0) return { kind: 'unplaced' }

  // 1. Admin aliases: the whole value, then its first part.
  for (const k of [parts.join(', '), parts[0]]) {
    const t = idx.aliases.get(k)
    if (t) {
      const r = fromTarget(t, idx)
      if (r) return r
    }
  }

  // 2. Country: the last part of a multi-part value (admin country aliases, then built-in names).
  let country: string | null = null
  if (parts.length > 1) {
    const last = parts[parts.length - 1]
    const t = idx.aliases.get(last)
    if (t?.startsWith('country:') && isIso2(t.slice(8).toUpperCase())) country = t.slice(8).toUpperCase()
    else country = countryFromText(last)
  }

  // 3. City: the first part, inside the resolved country when there is one.
  const matches = idx.byName.get(parts[0]) ?? []
  if (country) {
    const inCountry = matches.filter((c) => c.country === country)
    if (inCountry.length === 1) return { kind: 'city', key: inCountry[0].key, country }
    // Several map cities share the name inside one country (or none match): country only.
    return { kind: 'countryOnly', country }
  }

  // No country in the value.
  if (matches.length === 1) return { kind: 'city', key: matches[0].key, country: matches[0].country }
  // Ambiguous (Santiago, Valencia): stays unplaced until an alias decides.
  if (matches.length > 1) return { kind: 'unplaced' }
  // A bare country ("Brazil", "usa").
  if (parts.length === 1) {
    const c = countryFromText(parts[0])
    if (c) return { kind: 'countryOnly', country: c }
  }
  return { kind: 'unplaced' }
}
