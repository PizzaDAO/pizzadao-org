// pizzaiolo-13628 — city → timezone resolution.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./db', () => ({
  prisma: { memberProfileExtras: { upsert: vi.fn() } },
}))

import { prisma } from './db'
import {
  abbreviateTimezoneName,
  CityTimezoneError,
  formatUtcOffset,
  isValidTimezoneId,
  resolveCityTimezone,
  saveMemberTimezone,
} from './city-timezone'

const upsert = (prisma as unknown as { memberProfileExtras: { upsert: ReturnType<typeof vi.fn> } })
  .memberProfileExtras.upsert

function jsonResponse(body: unknown) {
  return { json: async () => body }
}

describe('formatUtcOffset', () => {
  it('formats whole, fractional, zero and negative offsets', () => {
    expect(formatUtcOffset(-18000)).toBe('-5')
    expect(formatUtcOffset(19800)).toBe('+5:30')
    expect(formatUtcOffset(0)).toBe('+0')
    expect(formatUtcOffset(-12600)).toBe('-3:30')
  })
})

describe('abbreviateTimezoneName', () => {
  it('uses the initials of multi-word names', () => {
    expect(abbreviateTimezoneName('Eastern Daylight Time')).toBe('EDT')
    expect(abbreviateTimezoneName('Australian Eastern Daylight Time')).toBe('AEDT')
  })

  it('returns empty for single-word or empty names', () => {
    expect(abbreviateTimezoneName('GMT')).toBe('')
    expect(abbreviateTimezoneName('')).toBe('')
  })
})

describe('isValidTimezoneId', () => {
  it('accepts IANA zones', () => {
    expect(isValidTimezoneId('America/New_York')).toBe(true)
    expect(isValidTimezoneId('Asia/Kolkata')).toBe(true)
  })

  it('rejects junk', () => {
    expect(isValidTimezoneId('Not/AZone')).toBe(false)
    expect(isValidTimezoneId('')).toBe(false)
    expect(isValidTimezoneId(42)).toBe(false)
    expect(isValidTimezoneId('<script>')).toBe(false)
  })
})

describe('resolveCityTimezone', () => {
  it('geocodes the place and returns the IANA zone with a label', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ status: 'OK', results: [{ geometry: { location: { lat: 40.7, lng: -74 } } }] }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'OK',
          timeZoneId: 'America/New_York',
          timeZoneName: 'Eastern Daylight Time',
          rawOffset: -18000,
          dstOffset: 3600,
        }),
      )

    const result = await resolveCityTimezone('place-123', {
      apiKey: 'k',
      fetchImpl,
      now: new Date('2026-07-01T00:00:00Z'),
    })

    expect(result).toEqual({
      timezoneId: 'America/New_York',
      timezoneName: 'Eastern Daylight Time',
      utcOffset: '-4',
      label: 'EDT (UTC-4)',
    })
    const [geoUrl] = fetchImpl.mock.calls[0]
    expect(geoUrl).toContain('place_id=place-123')
    const [tzUrl] = fetchImpl.mock.calls[1]
    expect(tzUrl).toContain('location=40.7%2C-74')
    expect(tzUrl).toContain(`timestamp=${Date.parse('2026-07-01T00:00:00Z') / 1000}`)
  })

  it('requires a place_id', async () => {
    await expect(resolveCityTimezone('  ', { apiKey: 'k', fetchImpl: vi.fn() })).rejects.toMatchObject({
      status: 400,
    })
  })

  it('requires an API key', async () => {
    const prev = process.env.GOOGLE_MAPS_API_KEY
    delete process.env.GOOGLE_MAPS_API_KEY
    try {
      await expect(resolveCityTimezone('p', { fetchImpl: vi.fn() })).rejects.toMatchObject({ status: 500 })
    } finally {
      if (prev !== undefined) process.env.GOOGLE_MAPS_API_KEY = prev
    }
  })

  it('surfaces geocoding failures as 502', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ status: 'INVALID_REQUEST' }))
    const err = await resolveCityTimezone('p', { apiKey: 'k', fetchImpl }).catch((e) => e)
    expect(err).toBeInstanceOf(CityTimezoneError)
    expect(err.status).toBe(502)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('surfaces timezone API failures as 502', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ status: 'OK', results: [{ geometry: { location: { lat: 1, lng: 2 } } }] }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: 'ZERO_RESULTS' }))
    await expect(resolveCityTimezone('p', { apiKey: 'k', fetchImpl })).rejects.toMatchObject({
      status: 502,
    })
  })
})

describe('saveMemberTimezone', () => {
  beforeEach(() => {
    upsert.mockReset()
  })

  it('upserts a valid timezone into MemberProfileExtras', async () => {
    upsert.mockResolvedValue({})
    expect(await saveMemberTimezone('42', 'Europe/Paris')).toBe(true)
    expect(upsert).toHaveBeenCalledWith({
      where: { memberId: '42' },
      create: { memberId: '42', timezone: 'Europe/Paris' },
      update: { timezone: 'Europe/Paris' },
    })
  })

  it('ignores invalid timezones and missing member ids', async () => {
    expect(await saveMemberTimezone('42', 'Mars/Olympus')).toBe(false)
    expect(await saveMemberTimezone('', 'Europe/Paris')).toBe(false)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('never throws when the DB write fails', async () => {
    upsert.mockRejectedValue(new Error('column does not exist'))
    expect(await saveMemberTimezone('42', 'Europe/Paris')).toBe(false)
  })
})
