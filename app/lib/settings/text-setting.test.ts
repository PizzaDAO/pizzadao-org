// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))

import { SETTINGS, textSetting } from './registry'

describe('textSetting options', () => {
  it('supports a check, placeholder and explicit onReadFailure', () => {
    const def = textSetting({
      key: 'x.y',
      area: 'guide',
      label: 'l',
      help: 'h',
      maxLength: 20,
      placeholder: 'e.g. abc',
      check: (v) => v === '' || /^[a-z]+$/.test(v),
      checkMessage: 'letters only',
      onReadFailure: 'lastKnownGood',
    })
    expect(def.input).toEqual({ type: 'text', maxLength: 20, placeholder: 'e.g. abc' })
    expect(def.onReadFailure).toBe('lastKnownGood')
    expect(def.schema.safeParse('abc').success).toBe(true)
    expect(def.schema.safeParse('').success).toBe(true)
    expect(def.schema.safeParse('ab1').success).toBe(false)
  })

  it('guide.* text settings keep the explicit empty failure value', () => {
    expect(SETTINGS['guide.hashtags'].onReadFailure).toEqual({ value: '' })
    expect(SETTINGS['guide.hostDeadlines'].onReadFailure).toEqual({ value: '' })
  })
})

describe('pfp.lockedReviewLink', () => {
  it('accepts empty or an internal path only', () => {
    const { schema } = SETTINGS['pfp.lockedReviewLink']
    for (const ok of ['', '/review/abc']) expect(schema.safeParse(ok).success).toBe(true)
    for (const bad of ['/\\evil.com', '/\t/evil.com', '//evil.com', '/a/../b', 'https://x.y', 'review/abc']) {
      expect(schema.safeParse(bad).success, bad).toBe(false)
    }
  })
})
