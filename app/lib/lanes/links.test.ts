import { describe, it, expect } from 'vitest'
import { isLaneSlug, isStepKind, parseStepLink } from './links'

describe('parseStepLink', () => {
  it('accepts empty (no link), internal paths and allowlisted https links', () => {
    expect(parseStepLink(undefined)).toEqual({ ok: true, value: null })
    expect(parseStepLink('  ')).toEqual({ ok: true, value: null })
    expect(parseStepLink('/handbook/host-a-party#budget')).toEqual({ ok: true, value: '/handbook/host-a-party#budget' })
    expect(parseStepLink('/tech/projects')).toEqual({ ok: true, value: '/tech/projects' })
    expect(parseStepLink('https://rsv.pizza/create')).toEqual({ ok: true, value: 'https://rsv.pizza/create' })
    expect(parseStepLink('https://docs.google.com/spreadsheets/d/x')).toMatchObject({ ok: true })
    expect(parseStepLink('https://www.github.com/PizzaDAO')).toMatchObject({ ok: true })
  })

  it('rejects dangerous schemes, protocol-relative paths and other hosts', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', '//evil.test/x', '/\\evil.test', 'http://rsv.pizza', 'https://evil.test', 'https://rsv.pizza.evil.test/x', 'https://notrsv.pizza', 'https://user:pw@rsv.pizza/x', 'ftp://rsv.pizza']) {
      expect(parseStepLink(bad), bad).toMatchObject({ ok: false })
    }
  })

  it('rejects /api, /login, /join and /admin paths and spaces', () => {
    for (const bad of ['/api/lanes/pin', '/api', '/login', '/join?lane=host', '/admin/lanes', '/handbook x', '/%2F%2Fevil']) {
      expect(parseStepLink(bad), bad).toMatchObject({ ok: false })
    }
  })

  it('rejects non-text and over-long values', () => {
    expect(parseStepLink(5)).toMatchObject({ ok: false })
    expect(parseStepLink('/' + 'a'.repeat(300))).toMatchObject({ ok: false })
  })
})

describe('slug and kind checks', () => {
  it('slugs are lowercase letters, digits and dashes up to 32', () => {
    expect(isLaneSlug('host')).toBe(true)
    expect(isLaneSlug('open-a-city')).toBe(true)
    expect(isLaneSlug('Host')).toBe(false)
    expect(isLaneSlug('a'.repeat(33))).toBe(false)
    expect(isLaneSlug('../x')).toBe(false)
    expect(isLaneSlug(5)).toBe(false)
  })
  it('step kinds', () => {
    expect(isStepKind('read') && isStepKind('do') && isStepKind('submit')).toBe(true)
    expect(isStepKind('other')).toBe(false)
  })
})
