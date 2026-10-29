import { describe, it, expect } from 'vitest'
import { capDecision, inQuietWindow, isQuiet, localHour, nextAllowedTime, validTimezone, DAY_MS } from './quiet-hours'

describe('quiet window', () => {
  it('wraps midnight (21 to 9)', () => {
    for (const h of [21, 22, 23, 0, 3, 8]) expect(inQuietWindow(h, 21, 9)).toBe(true)
    for (const h of [9, 12, 20]) expect(inQuietWindow(h, 21, 9)).toBe(false)
  })
  it('handles a same-day window and an empty one', () => {
    expect(inQuietWindow(13, 12, 14)).toBe(true)
    expect(inQuietWindow(14, 12, 14)).toBe(false)
    expect(inQuietWindow(5, 7, 7)).toBe(false)
  })
})

describe('recipient timezone', () => {
  it('uses the recipient local hour', () => {
    const t = new Date('2026-11-02T03:00:00Z') // 22:00 the evening before in New York (EST), 12:00 in Tokyo
    expect(localHour(t, 'America/New_York')).toBe(22)
    expect(localHour(t, 'Asia/Tokyo')).toBe(12)
    expect(isQuiet(t, 'America/New_York', 21, 9)).toBe(true)
    expect(isQuiet(t, 'Asia/Tokyo', 21, 9)).toBe(false)
  })
  it('falls back to UTC when the timezone is unknown or invalid', () => {
    const t = new Date('2026-11-02T03:00:00Z')
    expect(validTimezone(null)).toBe('UTC')
    expect(validTimezone('Not/AZone')).toBe('UTC')
    expect(localHour(t, null)).toBe(3)
    expect(isQuiet(t, undefined, 21, 9)).toBe(true)
  })
  it('midnight is hour 0, not 24', () => {
    expect(localHour(new Date('2026-11-02T00:10:00Z'), 'UTC')).toBe(0)
  })
})

describe('nextAllowedTime', () => {
  it('is now when not quiet', () => {
    const now = new Date('2026-11-02T12:00:00Z')
    expect(nextAllowedTime(now, 'UTC', 21, 9)).toEqual(now)
  })
  it('is the end of quiet hours in the recipient zone', () => {
    const now = new Date('2026-11-02T03:00:00Z') // 22:00 in New York
    const t = nextAllowedTime(now, 'America/New_York', 21, 9)
    expect(localHour(t, 'America/New_York')).toBe(9)
    expect(t.getTime()).toBeGreaterThan(now.getTime())
    expect(t.getTime() - now.getTime()).toBeLessThanOrEqual(12 * 3600_000)
  })
})

describe('daily cap', () => {
  const now = new Date('2026-11-02T12:00:00Z')
  const ago = (h: number) => new Date(now.getTime() - h * 3600_000)
  it('allows below the cap', () => {
    expect(capDecision([ago(1), ago(2)], now, 3)).toEqual({ ok: true })
  })
  it('blocks at the cap and says when the oldest send leaves the window', () => {
    const r = capDecision([ago(1), ago(5), ago(20)], now, 3)
    expect(r).toEqual({ ok: false, retryAt: new Date(ago(20).getTime() + DAY_MS) })
  })
  it('ignores sends older than 24 hours', () => {
    expect(capDecision([ago(30), ago(26), ago(25), ago(1)], now, 3)).toEqual({ ok: true })
  })
  it('a cap of 1 waits for the single recent send', () => {
    const r = capDecision([ago(2)], now, 1)
    expect(r.ok).toBe(false)
  })
})
