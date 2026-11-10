// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { ISO_ALPHA2, ISO_NUMERIC, countryFromText, countryName, normalizeText } from './countries'
import { buildPlaceIndex, normalizeAliasMatch, resolvePlace } from './places'
import { memberScore } from './score'
import { bucketCount, buildPublicPayload, tierLevel } from './aggregate'
import { MAP_CITIES } from './service'
import type { MapCity, MapLevelsConfig, PlaceAlias, ScoredMember } from './types'

const city = (key: string, name: string, country: string): MapCity => ({
  key,
  name,
  country,
  isoNumeric: ISO_NUMERIC[country],
  coords: [0, 0],
})
const CITIES = [
  city('new-york-840', 'New York', 'US'),
  city('philadelphia-840', 'Philadelphia', 'US'),
  city('valencia-724', 'Valencia', 'ES'),
  city('valencia-862', 'Valencia', 'VE'),
  city('lagos-566', 'Lagos', 'NG'),
  city('washington-840', 'Washington', 'US'),
]
const idx = (aliases: PlaceAlias[] = []) => buildPlaceIndex(CITIES, aliases)

describe('countries', () => {
  it('every code has a distinct 3-digit numeric id', () => {
    const nums = Object.values(ISO_NUMERIC)
    expect(new Set(nums).size).toBe(nums.length)
    for (const n of nums) expect(n).toMatch(/^\d{3}$/)
  })
  it('names resolve for every code through Intl', () => {
    for (const c of ISO_ALPHA2) {
      const n = normalizeText(countryName(c))
      expect(countryFromText(n), c).toBeTruthy()
    }
  })
  it('spelling forms resolve', () => {
    expect(countryFromText('usa')).toBe('US')
    expect(countryFromText('uk')).toBe('GB')
    expect(countryFromText(normalizeText("Côte d'Ivoire"))).toBe('CI')
    expect(countryFromText('turkiye')).toBe('TR')
    expect(countryFromText('korea')).toBe('KR')
    expect(countryFromText('nowhere land')).toBeNull()
  })
  it('every map city has a known country and numeric id', () => {
    for (const c of MAP_CITIES) {
      expect(ISO_NUMERIC[c.country], c.key).toBe(c.isoNumeric)
    }
    expect(new Set(MAP_CITIES.map((c) => c.key)).size).toBe(MAP_CITIES.length)
  })
})

describe('resolvePlace', () => {
  it('Google format with 3 and 2 parts, accents and case', () => {
    expect(resolvePlace('New York, NY, USA', idx())).toEqual({ kind: 'city', key: 'new-york-840', country: 'US' })
    expect(resolvePlace('LAGOS, Nigeria', idx())).toEqual({ kind: 'city', key: 'lagos-566', country: 'NG' })
    expect(resolvePlace('Philadelphia, PA, United States', idx())).toEqual({ kind: 'city', key: 'philadelphia-840', country: 'US' })
  })
  it('matches a city only inside its resolved country', () => {
    expect(resolvePlace('Valencia, Spain', idx())).toEqual({ kind: 'city', key: 'valencia-724', country: 'ES' })
    expect(resolvePlace('Valencia, Venezuela', idx())).toEqual({ kind: 'city', key: 'valencia-862', country: 'VE' })
    expect(resolvePlace('Lagos, Portugal', idx())).toEqual({ kind: 'countryOnly', country: 'PT' })
  })
  it('a bare city: unique match is taken, an ambiguous one stays unplaced', () => {
    expect(resolvePlace('lagos', idx())).toEqual({ kind: 'city', key: 'lagos-566', country: 'NG' })
    expect(resolvePlace('Valencia', idx())).toEqual({ kind: 'unplaced' })
  })
  it('a bare country counts for the country only', () => {
    expect(resolvePlace('Brazil', idx())).toEqual({ kind: 'countryOnly', country: 'BR' })
    expect(resolvePlace('USA', idx())).toEqual({ kind: 'countryOnly', country: 'US' })
  })
  it('a city not on the map counts for its country', () => {
    expect(resolvePlace('Brooklyn, NY, USA', idx())).toEqual({ kind: 'countryOnly', country: 'US' })
  })
  it('aliases: to a city, to a country, ignore; d.c. normalises to dc', () => {
    const a = idx([
      { match: 'NYC', target: 'new-york-840' },
      { match: 'brooklyn, ny, usa', target: 'new-york-840' },
      { match: 'D.C.', target: 'washington-840' },
      { match: 'nomadic', target: 'ignore' },
      { match: 'the shire', target: 'country:nz' },
    ])
    expect(resolvePlace('nyc', a)).toEqual({ kind: 'city', key: 'new-york-840', country: 'US' })
    expect(resolvePlace('Brooklyn, NY, USA', a)).toEqual({ kind: 'city', key: 'new-york-840', country: 'US' })
    expect(resolvePlace('d.c.', a)).toEqual({ kind: 'city', key: 'washington-840', country: 'US' })
    expect(resolvePlace('Nomadic', a)).toEqual({ kind: 'unplaced' })
    expect(resolvePlace('The Shire', a)).toEqual({ kind: 'countryOnly', country: 'NZ' })
    expect(normalizeAliasMatch('D.C.')).toBe('dc')
  })
  it('empty and junk are unplaced', () => {
    expect(resolvePlace('', idx())).toEqual({ kind: 'unplaced' })
    expect(resolvePlace(null, idx())).toEqual({ kind: 'unplaced' })
    expect(resolvePlace(' , ', idx())).toEqual({ kind: 'unplaced' })
    expect(resolvePlace('somewhere odd', idx())).toEqual({ kind: 'unplaced' })
  })
})

const W = { weightLevel: 10, weightMission: 2, missionCap: 40, weightPep: 5, pepCap: 10_000, scoreCap: 150 }

describe('memberScore', () => {
  const base = { hasDiscord: true, level: 1, approvedMissions: 0, pep: 0 }
  it('level 1 with nothing is 0; weights apply', () => {
    expect(memberScore(base, W)).toBe(0)
    expect(memberScore({ ...base, level: 4 }, W)).toBe(30)
    expect(memberScore({ ...base, approvedMissions: 5 }, W)).toBe(10)
  })
  it('PEP is log damped and capped; a whale equals the cap', () => {
    expect(memberScore({ ...base, pep: 99 }, W)).toBeCloseTo(10)
    expect(memberScore({ ...base, pep: 10_000 }, W)).toBe(memberScore({ ...base, pep: 99_999_999 }, W))
    expect(memberScore({ ...base, pep: 10_000 }, W)).toBeCloseTo(5 * Math.log10(10_001))
  })
  it('negative or non-finite PEP adds nothing', () => {
    expect(memberScore({ ...base, pep: -50 }, W)).toBe(0)
    expect(memberScore({ ...base, pep: NaN }, W)).toBe(0)
  })
  it('mission cap and score cap', () => {
    expect(memberScore({ ...base, approvedMissions: 400 }, W)).toBe(80)
    expect(memberScore({ hasDiscord: true, level: 20, approvedMissions: 400, pep: 10_000 }, W)).toBe(150)
    expect(memberScore({ hasDiscord: true, level: 20, approvedMissions: 400, pep: 10_000 }, { ...W, scoreCap: 0 })).toBeGreaterThan(150)
  })
  it('no Discord scores 0', () => {
    expect(memberScore({ hasDiscord: false, level: 9, approvedMissions: 40, pep: 10_000 }, W)).toBe(0)
  })
})

const TIERS = [
  { name: 'Dough', cityMin: 0, countryMin: 0 },
  { name: 'Sauce', cityMin: 100, countryMin: 250 },
  { name: 'Cheese', cityMin: 300, countryMin: 750 },
  { name: 'Whole Pie', cityMin: 750, countryMin: 2000 },
]
const CFG: MapLevelsConfig = { ...W, minMembersCity: 3, minMembersCountry: 3, tiers: TIERS, buckets: [3, 5, 10, 25, 50, 100], aliases: [] }
const at = (key: string, country: string, score: number, n = 1): ScoredMember[] =>
  Array.from({ length: n }, (_, i) => ({ place: { kind: 'city' as const, key, country }, score, discordId: `${key}-${i}` }))

describe('aggregate', () => {
  it('tier boundaries are inclusive', () => {
    expect(tierLevel(0, TIERS, 'city')).toBe(1)
    expect(tierLevel(99.9, TIERS, 'city')).toBe(1)
    expect(tierLevel(100, TIERS, 'city')).toBe(2)
    expect(tierLevel(749, TIERS, 'city')).toBe(3)
    expect(tierLevel(750, TIERS, 'city')).toBe(4)
    expect(tierLevel(2000, TIERS, 'country')).toBe(4)
    expect(tierLevel(1999, TIERS, 'country')).toBe(3)
  })
  it('bucketing', () => {
    const b = CFG.buckets
    expect(bucketCount(2, b)).toBeNull()
    expect(bucketCount(3, b)).toBe('3+')
    expect(bucketCount(24, b)).toBe('10+')
    expect(bucketCount(500, b)).toBe('100+')
    expect(bucketCount(30, [])).toBeNull()
  })
  it('places below the minimum are absent; a hidden city still counts toward its country', () => {
    const members = [...at('lagos-566', 'NG', 50, 2), ...at('abeokuta-566', 'NG', 50, 1)]
    const p = buildPublicPayload(members, [city('lagos-566', 'Lagos', 'NG'), city('abeokuta-566', 'Abeokuta', 'NG')], CFG)
    expect(p.cities).toEqual([])
    expect(p.countries).toHaveLength(1)
    expect(p.countries[0]).toMatchObject({ iso2: 'NG', isoNumeric: '566', level: 1, members: '3+' })
    // Country-only members count toward the country, not a city.
    const co: ScoredMember[] = [{ place: { kind: 'countryOnly', country: 'BR' }, score: 300, discordId: 'b1' }, { place: { kind: 'countryOnly', country: 'BR' }, score: 0, discordId: 'b2' }]
    expect(buildPublicPayload(co, [], CFG).countries).toEqual([])
    const co3: ScoredMember[] = [...co, { place: { kind: 'countryOnly', country: 'BR' }, score: 0, discordId: 'b3' }]
    expect(buildPublicPayload(co3, [], CFG).countries[0]).toMatchObject({ iso2: 'BR', level: 2 })
  })
  it('an empty bucket list publishes no members field; unplaced members are ignored', () => {
    const members: ScoredMember[] = [...at('lagos-566', 'NG', 40, 4), { place: { kind: 'unplaced' }, score: 999 }]
    const p = buildPublicPayload(members, [city('lagos-566', 'Lagos', 'NG')], { ...CFG, buckets: [] })
    expect(p.cities[0]).toEqual({ key: 'lagos-566', name: 'Lagos', country: 'NG', level: 2 })
    expect('members' in p.cities[0]).toBe(false)
  })
})

describe('privacy', () => {
  it('the payload holds only whitelisted keys and none of the sentinels', () => {
    const members: ScoredMember[] = at('lagos-566', 'NG', 777, 12)
    const p = buildPublicPayload(members, [city('lagos-566', 'Lagos', 'NG')], CFG, new Date('2026-11-10T00:00:00Z'))
    expect(Object.keys(p).sort()).toEqual(['cities', 'countries', 'generatedAt', 'tiers', 'version'])
    expect(Object.keys(p.cities[0]).sort()).toEqual(['country', 'key', 'level', 'members', 'name'])
    expect(Object.keys(p.countries[0]).sort()).toEqual(['isoNumeric', 'iso2', 'level', 'members', 'name'].sort())
    const json = JSON.stringify(p)
    // The summed score (12 x 777 = 9324) and the exact count must not appear.
    expect(json).not.toContain('9324')
    expect(json).not.toContain('777')
    expect(p.cities[0].members).toBe('10+')
  })
})
