// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { MAP_LEVELS_SETTINGS, DEFAULT_TIERS } from './map-levels-settings'
import { TOGGLES } from './toggles'

const S = MAP_LEVELS_SETTINGS

describe('map levels settings', () => {
  it('every default passes its own schema; the switch is off by default', () => {
    for (const [key, def] of Object.entries(S)) {
      expect(def.schema.safeParse(def.default).success, key).toBe(true)
    }
    expect(S['map.levelsEnabled'].default).toBe(false)
    expect(TOGGLES['map.levelsEnabled'].legacy(undefined)).toBe(false)
  })

  it('has 4 tiers by default; they must start at 0 and rise', () => {
    expect(DEFAULT_TIERS).toHaveLength(4)
    const t = S['map.tiers'].schema
    expect(t.safeParse([{ name: 'A', cityMin: 5, countryMin: 0 }]).success).toBe(false)
    expect(t.safeParse([{ name: 'A', cityMin: 0, countryMin: 0 }, { name: 'B', cityMin: 0, countryMin: 5 }]).success).toBe(false)
    expect(t.safeParse([{ name: 'A', cityMin: 0, countryMin: 0 }, { name: 'a', cityMin: 5, countryMin: 5 }]).success).toBe(false)
    expect(t.safeParse([{ name: 'A', cityMin: 0, countryMin: 0 }, { name: 'B', cityMin: 5, countryMin: 5 }]).success).toBe(true)
  })

  it('member count steps must be whole numbers and rise', () => {
    const b = S['map.memberCountBuckets'].schema
    expect(b.safeParse([]).success).toBe(true)
    expect(b.safeParse(['3', '3']).success).toBe(false)
    expect(b.safeParse(['3', 'x']).success).toBe(false)
  })

  it('alias targets are validated and matches normalised', () => {
    const a = S['map.placeAliases'].schema
    const ok = a.safeParse([{ match: 'D.C.', target: 'country:us' }, { match: 'Nomadic', target: 'ignore' }])
    expect(ok.success).toBe(true)
    if (ok.success) expect(ok.data).toEqual([{ match: 'dc', target: 'country:US' }, { match: 'nomadic', target: 'ignore' }])
    expect(a.safeParse([{ match: 'x', target: 'atlantis-000' }]).success).toBe(false)
    expect(a.safeParse([{ match: 'x', target: 'country:ZZ' }]).success).toBe(false)
    expect(a.safeParse([{ match: 'A', target: 'ignore' }, { match: 'a', target: 'ignore' }]).success).toBe(false)
    expect(a.safeParse([{ match: 'x', target: 'lagos-566' }]).success).toBe(true)
  })

  it('lowering a minimum below 3 asks for confirmation', () => {
    const c = S['map.minMembersCity'].confirm!
    expect(c(3, 2)).toMatch(/Continue/)
    expect(c(3, 5)).toBeNull()
    expect(c(2, 1)).toMatch(/Continue/)
  })
})
