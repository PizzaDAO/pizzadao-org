// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { GUIDE_HREF_MAX, parseGuideHref } from './guide-href'

describe('parseGuideHref', () => {
  it('accepts internal handbook-style paths, trimmed', () => {
    for (const ok of [
      '/handbook',
      '/handbook/levels',
      '/handbook/levels#vouching',
      '/handbook/getting-started#connect-x',
      '/calls/how-to-attend',
      '/manuals',
      '/vouches',
      '/missions',
    ]) {
      expect(parseGuideHref(` ${ok} `), ok).toEqual({ ok: true, value: ok })
    }
  })

  it('treats empty and null as no link', () => {
    expect(parseGuideHref('')).toEqual({ ok: true, value: null })
    expect(parseGuideHref('   ')).toEqual({ ok: true, value: null })
    expect(parseGuideHref(null)).toEqual({ ok: true, value: null })
    expect(parseGuideHref(undefined)).toEqual({ ok: true, value: null })
  })

  it('rejects anything that is not an internal path under a known root', () => {
    for (const bad of [
      'https://example.org',
      'javascript:alert(1)',
      'data:text/html,x',
      '//example.org',
      '/admin',
      '/api/auth/logout',
      '/handbook/a/b',
      '/handbook?x=1',
      '/handbook#UPPER',
      '/handbook#',
      '/handbook/levels#a b',
      '/Handbook',
      '/handbook\n/x',
      'handbook',
    ]) {
      expect(parseGuideHref(bad).ok, bad).toBe(false)
    }
    expect(parseGuideHref(42).ok).toBe(false)
    expect(parseGuideHref('/handbook/' + 'a'.repeat(GUIDE_HREF_MAX)).ok).toBe(false)
  })
})
