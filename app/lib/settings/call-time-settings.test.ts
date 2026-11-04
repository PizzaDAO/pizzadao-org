import { describe, expect, it } from 'vitest'
import { SETTINGS } from './registry'

const schema = SETTINGS['calls.eventLocalTimes'].schema
const good = { eventId: '1234567890123456789', label: 'Ops', localTime: '9:05', timeZone: 'America/New_York' }

describe('calls.eventLocalTimes', () => {
  it('normalizes the time and defaults a blank zone to New York', () => {
    const r = schema.safeParse([{ ...good, timeZone: '' }])
    expect(r.success && r.data).toEqual([{ ...good, localTime: '09:05', timeZone: 'America/New_York' }])
  })
  it('rejects bad ids, times, zones and duplicates', () => {
    expect(schema.safeParse([{ ...good, eventId: '12' }]).success).toBe(false)
    expect(schema.safeParse([{ ...good, localTime: '25:00' }]).success).toBe(false)
    expect(schema.safeParse([{ ...good, timeZone: 'Mars/Base' }]).success).toBe(false)
    expect(schema.safeParse([good, good]).success).toBe(false)
  })
})
