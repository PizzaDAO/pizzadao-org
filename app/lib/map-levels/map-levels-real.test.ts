// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { COUNTRY_ALIASES, ISO_ALPHA2, ISO_NUMERIC, isIso2 } from './countries'
import { BUILTIN_CITY_NAMES, buildPlaceIndex, placeParts, resolvePlace } from './places'
import { buildPublicPayload } from './aggregate'
import { buildAdminPreview } from './preview'
import { MAP_CITIES } from './service'
import type { MapCity, MapLevelsConfig, ScoredMember } from './types'

const W = { weightLevel: 10, weightMission: 2, missionCap: 40, weightPep: 5, pepCap: 10_000, scoreCap: 150 }
const TIERS = [
  { name: 'Dough', cityMin: 0, countryMin: 0 },
  { name: 'Sauce', cityMin: 100, countryMin: 250 },
]
const CFG: MapLevelsConfig = { ...W, minMembersCity: 3, minMembersCountry: 3, tiers: TIERS, buckets: [3, 5, 10, 25], aliases: [] }
const lagos: MapCity[] = [{ key: 'lagos-566', name: 'Lagos', country: 'NG', isoNumeric: '566', coords: [0, 0] }]
const at = (n: number, withDiscord = true): ScoredMember[] =>
  Array.from({ length: n }, (_, i) => ({
    place: { kind: 'city' as const, key: 'lagos-566', country: 'NG' },
    score: 50,
    ...(withDiscord ? { discordId: `d${i}` } : {}),
  }))

describe('countries: current ISO codes only', () => {
  it('every alias value is in the table', () => {
    for (const [alias, code] of Object.entries(COUNTRY_ALIASES)) expect(ISO_NUMERIC[code], alias).toBeTruthy()
  })
  it('no withdrawn or reserved alpha-2 codes; Intl knows every code', () => {
    const dn = new Intl.DisplayNames(['en'], { type: 'region' })
    for (const c of ISO_ALPHA2) expect(dn.of(c), c).not.toBe(c)
    for (const bad of ['UK', 'FX', 'SU', 'DY', 'HV', 'TP', 'YU', 'AN', 'BU', 'CS', 'DD', 'ZR', 'EU']) expect(isIso2(bad), bad).toBe(false)
    for (const good of ['GB', 'FR', 'RU', 'BJ', 'BF', 'RS', 'TL']) expect(isIso2(good), good).toBe(true)
  })
  it('the synced map cities carry current codes only', () => {
    for (const c of MAP_CITIES) expect(isIso2(c.country), c.key).toBe(true)
  })
})

describe('real map cities and aliases', () => {
  const real = buildPlaceIndex(MAP_CITIES, [])
  const key = (s: string) => (resolvePlace(s, real) as { key?: string }).key
  it('UK and Russia values resolve', () => {
    expect(resolvePlace('London, UK', real)).toEqual({ kind: 'city', key: 'london-826', country: 'GB' })
    expect(resolvePlace('Leeds, UK', real)).toEqual({ kind: 'countryOnly', country: 'GB' })
    expect(resolvePlace('Moscow, Russia', real)).toMatchObject({ country: 'RU' })
  })
  it('obvious spellings match without admin work', () => {
    expect(key('New York, NY, USA')).toBe('new-york-city-840')
    expect(key('NYC')).toBe('new-york-city-840')
    expect(key('Brooklyn, NY, USA')).toBe('new-york-city-840')
    expect(key('San Francisco, CA, USA')).toBe('san-francisco-840')
    expect(key('SF')).toBe('san-francisco-840')
    expect(key('LA')).toBe('los-angeles-840')
    expect(key('Washington, DC, USA')).toBe('washington-dc-840')
    expect(key('D.C.')).toBe('washington-dc-840')
    expect(key('Bengaluru, Karnataka, India')).toBe('bangalore-356')
    expect(key('Kiev, Ukraine')).toBe('kyiv-804')
  })
  it('every built-in city name points at a real map city', () => {
    for (const [name, k] of Object.entries(BUILTIN_CITY_NAMES)) expect(MAP_CITIES.some((c) => c.key === k), name).toBe(true)
  })
})

describe('minimum counts distinct members with a Discord id', () => {
  it('rows without Discord do not reach the minimum, but add to the count bucket once it is met', () => {
    expect(buildPublicPayload([...at(2), ...at(10, false)], lagos, CFG).cities).toEqual([])
    expect(buildPublicPayload([...at(3), ...at(10, false)], lagos, CFG).cities[0].members).toBe('10+')
  })
  it('a Discord id counts once per place', () => {
    const dup: ScoredMember[] = Array.from({ length: 5 }, () => ({ place: { kind: 'city' as const, key: 'lagos-566', country: 'NG' }, score: 50, discordId: 'same' }))
    expect(buildPublicPayload(dup, lagos, CFG).cities).toEqual([])
  })
})

describe('admin preview', () => {
  it('shows raw numbers and typed values; the public part stays whitelisted', () => {
    const idx = buildPlaceIndex(lagos, [])
    const typed = ['Lagos, Nigeria', 'Lagos', 'Lagos, NG', 'Ibadan, Nigeria', 'nomadic', 'nomadic', '']
    const rows = typed.map((raw, i) => ({ place: resolvePlace(raw, idx), raw: placeParts(raw).join(', '), discordId: `d${i}`, score: 60 }))
    const p = buildAdminPreview(rows, lagos, CFG, '2026-11-10')
    expect(p.totals).toMatchObject({ members: 7, inCity: 3, countryOnly: 1, unplaced: 3 })
    expect(p.cities[0]).toMatchObject({ key: 'lagos-566', members: 3, scored: 3, score: 180, tier: 'Sauce', passes: true })
    expect(p.countries[0]).toMatchObject({ iso2: 'NG', members: 4, passes: true })
    expect(p.unmatched[0]).toEqual({ value: 'nomadic', count: 2, outcome: 'no place found' })
    expect(p.unmatched.some((u) => u.value === 'ibadan, nigeria' && u.outcome === 'country only (NG)')).toBe(true)
    expect(JSON.stringify(p.public)).not.toContain('nomadic')
    expect(p.public.cities[0]).toMatchObject({ key: 'lagos-566', level: 2, members: '3+' })
  })
})
