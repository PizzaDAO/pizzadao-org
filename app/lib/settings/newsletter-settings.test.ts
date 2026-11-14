// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { SETTINGS, parseSetting } from './registry'
import { TOGGLES, resolveToggle, type ToggleKey } from './toggles'
import type { Settings } from './index'
import { NEWSLETTER_SETTINGS } from './newsletter-settings'
import { displayName, newsletterSender } from '@/app/lib/newsletter/sender'

const KEYS = ['newsletter.confirmEmailsEnabled', 'newsletter.memberOptInEnabled'] as const
const snapshot = (values: Record<string, unknown> = {}, over: Partial<Settings> = {}): Settings =>
  ({
    readFailed: false,
    invalidKeys: [],
    isSet: (k: string) => k in values,
    get: (k: string) => (k in values ? values[k] : (SETTINGS as never as Record<string, { default: unknown }>)[k].default),
    ...over,
  }) as Settings

describe('newsletter settings', () => {
  it('every newsletter toggle is registered, defaults off and has an env kill switch', () => {
    for (const k of KEYS) {
      expect(NEWSLETTER_SETTINGS[k].default).toBe(false)
      expect(NEWSLETTER_SETTINGS[k].input.type).toBe('bool')
      expect(TOGGLES[k as ToggleKey].legacy(undefined)).toBe(false)
      expect(resolveToggle(k, snapshot(), { VERCEL_ENV: 'production' })).toBe(false)
    }
  })

  it('a saved ON counts in production, is ignored on previews, loses to the env kill switch and to unreadable settings', () => {
    for (const k of KEYS) {
      const on = snapshot({ [k]: true })
      expect(resolveToggle(k, on, { VERCEL_ENV: 'production' })).toBe(true)
      expect(resolveToggle(k, on, { VERCEL_ENV: 'preview' })).toBe(false)
      expect(resolveToggle(k, on, { VERCEL_ENV: 'production', [TOGGLES[k as ToggleKey].env]: 'off' })).toBe(false)
      expect(resolveToggle(k, snapshot({ [k]: true }, { readFailed: true }), { VERCEL_ENV: 'production' })).toBe(false)
    }
  })

  it('turning a toggle on asks for confirmation, turning it off does not', () => {
    for (const k of KEYS) {
      expect(NEWSLETTER_SETTINGS[k].confirm?.(false, true)).toEqual(expect.any(String))
      expect(NEWSLETTER_SETTINGS[k].confirm?.(true, false)).toBeNull()
    }
  })

  it('sender settings default to empty (no hard-coded address) and validate', () => {
    expect(NEWSLETTER_SETTINGS['newsletter.fromAddress'].default).toBe('')
    expect(NEWSLETTER_SETTINGS['newsletter.fromName'].default).toBe('')
    expect(NEWSLETTER_SETTINGS['newsletter.replyTo'].default).toBe('')
    expect(parseSetting('newsletter.fromAddress', 'news@example.org').ok).toBe(true)
    expect(parseSetting('newsletter.fromAddress', 'not an address').ok).toBe(false)
    expect(parseSetting('newsletter.replyTo', 'x').ok).toBe(false)
    expect(parseSetting('newsletter.fromName', 'Bad <name>').ok).toBe(false)
    for (const bad of ['A, B', 'A; B', 'A: B', 'A\\B', 'A"B']) expect(parseSetting('newsletter.fromName', bad).ok).toBe(false)
    expect(parseSetting('newsletter.fromName', 'Example News-1.0').ok).toBe(true)
  })

  it('quotes a display name that has specials (RFC 5322) and leaves plain names bare', () => {
    expect(displayName('Example News')).toBe('Example News')
    expect(displayName('Doe, Jane')).toBe('"Doe, Jane"')
    expect(displayName('A\\B')).toBe('"A\\\\B"')
    expect(newsletterSender(snapshot({ 'newsletter.fromAddress': 'news@example.org', 'newsletter.fromName': 'News; Team' }))?.from).toBe('"News; Team" <news@example.org>')
  })

  it('no sender address: no sender at all; otherwise name and reply-to are applied', () => {
    expect(newsletterSender(snapshot())).toBeNull()
    expect(newsletterSender(snapshot({ 'newsletter.fromName': 'Example' }))).toBeNull()
    expect(newsletterSender(snapshot({ 'newsletter.fromAddress': 'news@example.org' }))).toEqual({ from: 'news@example.org' })
    expect(
      newsletterSender(snapshot({ 'newsletter.fromAddress': 'news@example.org', 'newsletter.fromName': 'Example News', 'newsletter.replyTo': 'team@example.org' })),
    ).toEqual({ from: 'Example News <news@example.org>', replyTo: 'team@example.org' })
    expect(newsletterSender(snapshot({ 'newsletter.fromAddress': 'news@example.org' }, { readFailed: true }))).toBeNull()
  })
})
