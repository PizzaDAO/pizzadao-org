import { describe, expect, it } from 'vitest'
import { callDateFormat, callDateTimeFormat } from './format-call-time'

describe('format-call-time', () => {
  it('renders times in Eastern with a zone label', () => {
    const s = callDateTimeFormat('en-US').format(new Date('2026-01-15T23:30:00Z'))
    expect(s).toContain('6:30 PM')
    expect(s).toContain('EST')
  })
  it('observes daylight time', () => {
    expect(callDateTimeFormat('en-US').format(new Date('2026-07-15T23:30:00Z'))).toContain('EDT')
  })
  it('keeps an evening call on its own date', () => {
    expect(callDateFormat('en-US').format(new Date('2026-01-16T02:00:00Z'))).toBe('Jan 15, 2026')
  })
  it('honours an explicit zone', () => {
    expect(callDateTimeFormat('en-US', { timeZone: 'UTC' }).format(new Date('2026-01-15T23:30:00Z'))).toContain('UTC')
  })
})
