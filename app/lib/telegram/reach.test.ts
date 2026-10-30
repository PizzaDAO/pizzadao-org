import { describe, expect, it } from 'vitest'
import { backoffDays, canTryTelegram, nextReach, telegramEligibility } from './reach'

const cfg = { dmRecheckDays: 7, dmRecheckMaxDays: 60 }
const now = new Date('2026-11-10T12:00:00Z')
const DAY = 86_400_000

describe('canTryTelegram', () => {
  it('unknown, missing or OK: yes', () => {
    expect(canTryTelegram(null, now)).toBe(true)
    expect(canTryTelegram({ state: 'UNKNOWN', recheckAt: null }, now)).toBe(true)
    expect(canTryTelegram({ state: 'OK', recheckAt: null }, now)).toBe(true)
  })
  it('BLOCKED is sticky, even long after', () => {
    expect(canTryTelegram({ state: 'BLOCKED', recheckAt: null }, now)).toBe(false)
    expect(canTryTelegram({ state: 'BLOCKED', recheckAt: new Date(now.getTime() - 400 * DAY) }, now)).toBe(false)
  })
  it('NOT_STARTED waits for recheckAt', () => {
    expect(canTryTelegram({ state: 'NOT_STARTED', recheckAt: new Date(now.getTime() + DAY) }, now)).toBe(false)
    expect(canTryTelegram({ state: 'NOT_STARTED', recheckAt: new Date(now.getTime() - 1) }, now)).toBe(true)
    expect(canTryTelegram({ state: 'NOT_STARTED', recheckAt: null }, now)).toBe(false)
  })
})

describe('backoff', () => {
  it('doubles per consecutive failure and stops at the cap', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => backoffDays(n, cfg))).toEqual([7, 14, 28, 56, 60, 60])
  })
  it('follows the settings', () => {
    expect(backoffDays(3, { dmRecheckDays: 1, dmRecheckMaxDays: 7 })).toBe(4)
    expect(backoffDays(9, { dmRecheckDays: 1, dmRecheckMaxDays: 7 })).toBe(7)
  })
})

describe('nextReach', () => {
  it('ok resets everything', () => {
    expect(nextReach({ state: 'NOT_STARTED', failures: 3, recheckAt: now }, 'ok', now, cfg)).toEqual({ state: 'OK', failures: 0, recheckAt: null })
  })
  it('not_started counts consecutive failures and schedules the recheck', () => {
    const first = nextReach(null, 'not_started', now, cfg)
    expect(first).toEqual({ state: 'NOT_STARTED', failures: 1, recheckAt: new Date(now.getTime() + 7 * DAY) })
    const second = nextReach({ state: 'NOT_STARTED', failures: 1, recheckAt: first!.recheckAt }, 'not_started', now, cfg)
    expect(second).toEqual({ state: 'NOT_STARTED', failures: 2, recheckAt: new Date(now.getTime() + 14 * DAY) })
  })
  it('blocked is BLOCKED with no recheck', () => {
    expect(nextReach(null, 'blocked', now, cfg)).toEqual({ state: 'BLOCKED', failures: 0, recheckAt: null })
  })
  it('uncertain, rate limits and config problems change nothing', () => {
    for (const c of ['uncertain', 'rate_limited', 'bad_request', 'unavailable', 'not_configured'] as const) expect(nextReach(null, c, now, cfg)).toBeNull()
  })
})

describe('telegramEligibility', () => {
  const ok = { toggleOn: true, senderAllowed: true, linkSecretSet: true, telegramId: '1', reach: null, now }
  it('is eligible when everything lines up', () => {
    expect(telegramEligibility(ok)).toEqual({ eligible: true })
  })
  it('each missing piece says why', () => {
    expect(telegramEligibility({ ...ok, toggleOn: false })).toEqual({ eligible: false, why: 'off' })
    expect(telegramEligibility({ ...ok, senderAllowed: false })).toEqual({ eligible: false, why: 'off' })
    expect(telegramEligibility({ ...ok, linkSecretSet: false })).toEqual({ eligible: false, why: 'off' })
    expect(telegramEligibility({ ...ok, telegramId: null })).toEqual({ eligible: false, why: 'no-link' })
    expect(telegramEligibility({ ...ok, reach: { state: 'BLOCKED', recheckAt: null } })).toEqual({ eligible: false, why: 'blocked' })
    expect(telegramEligibility({ ...ok, reach: { state: 'NOT_STARTED', recheckAt: new Date(now.getTime() + DAY) } })).toEqual({ eligible: false, why: 'not-started' })
  })
})
