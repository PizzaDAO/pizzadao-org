// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { LANE_COOKIE, LANE_COOKIE_MAX_AGE, laneCookieOptions, normalizeLaneSlug, readLaneCookie } from './cookie'

const req = (cookie?: string) => new Request('https://app.test/x', { headers: cookie ? { cookie } : {} })

describe('pd_lane cookie', () => {
  it('reads a valid slug among other cookies', () => {
    expect(readLaneCookie(req('a=1; pd_lane=host; pd_ref=42'))).toBe('host')
    expect(readLaneCookie(req('pd_lane=grow-2'))).toBe('grow-2')
  })

  it('rejects anything that is not a plain slug', () => {
    for (const bad of ['', 'Host', 'ho st', '../x', 'a'.repeat(33), '<script>', '%2e%2e', 'a/b']) {
      expect(readLaneCookie(req(`${LANE_COOKIE}=${bad}`))).toBeNull()
    }
    expect(readLaneCookie(req())).toBeNull()
  })

  it('normalizes only strings (trimmed) that match the slug pattern', () => {
    expect(normalizeLaneSlug(' host ')).toBe('host')
    expect(normalizeLaneSlug(5)).toBeNull()
    expect(normalizeLaneSlug(null)).toBeNull()
    expect(normalizeLaneSlug({ slug: 'host' })).toBeNull()
  })

  it('is httpOnly, lax, whole-site and short-lived', () => {
    const o = laneCookieOptions(req())
    expect(o).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: LANE_COOKIE_MAX_AGE })
    expect(LANE_COOKIE_MAX_AGE).toBeLessThanOrEqual(7 * 24 * 60 * 60)
    expect(laneCookieOptions(req(), 0).maxAge).toBe(0)
  })
})
