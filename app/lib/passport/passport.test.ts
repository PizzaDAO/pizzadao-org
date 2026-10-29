// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))

import { boundingBox, haversineM, isValidLatLng } from './geo'
import { parseQrPath, qrCodeFor, qrPath, slugify, verifyQrCode } from './qr'
import { hasRoundCoords, isImpossibleTravel, isZeroAccuracy } from './abuse'
import { decideCheckIn, type DecisionInput } from './checkin'
import { canView, monthOnly, parseVisibility, visibleStamps } from './visibility'
import { killSwitchOn } from './config'
import { parsePartner } from './partner-input'
import { stampStyle } from '@/app/ui/passport/InkStamp'

const VENUE = { lat: 40.7128, lng: -74.006 }

describe('geo', () => {
  it('haversine is symmetric and roughly right', () => {
    const a = { lat: 40.7128, lng: -74.006 }
    const b = { lat: 51.5074, lng: -0.1278 }
    const d = haversineM(a, b)
    expect(d).toBeGreaterThan(5_500_000)
    expect(d).toBeLessThan(5_600_000)
    expect(haversineM(a, b)).toBeCloseTo(haversineM(b, a), 3)
    expect(haversineM(a, a)).toBe(0)
  })

  it('100 m north is about 100 m', () => {
    const d = haversineM(VENUE, { lat: VENUE.lat + 0.0009, lng: VENUE.lng })
    expect(d).toBeGreaterThan(95)
    expect(d).toBeLessThan(105)
  })

  it('bounding box contains points inside the radius and excludes far ones', () => {
    const box = boundingBox(VENUE, 500)
    const inside = { lat: VENUE.lat + 0.003, lng: VENUE.lng + 0.003 }
    expect(inside.lat).toBeGreaterThan(box.minLat)
    expect(inside.lat).toBeLessThan(box.maxLat)
    expect(inside.lng).toBeGreaterThan(box.minLng)
    expect(inside.lng).toBeLessThan(box.maxLng)
    expect(VENUE.lat + 0.05).toBeGreaterThan(box.maxLat)
  })

  it('validates coordinates', () => {
    expect(isValidLatLng({ lat: 1, lng: 2 })).toBe(true)
    expect(isValidLatLng({ lat: 91, lng: 2 })).toBe(false)
    expect(isValidLatLng({ lat: 1, lng: 181 })).toBe(false)
    expect(isValidLatLng({ lat: '1', lng: 2 })).toBe(false)
    expect(isValidLatLng({ lat: NaN, lng: 2 })).toBe(false)
  })
})

describe('qr', () => {
  const secret = 'test-secret'
  it('signs and verifies, and a version bump invalidates old codes', () => {
    const code = qrCodeFor('pz1', 1, secret)
    expect(code).toHaveLength(16)
    expect(verifyQrCode('pz1', 1, code, secret)).toBe(true)
    expect(verifyQrCode('pz1', 2, code, secret)).toBe(false)
    expect(verifyQrCode('pz2', 1, code, secret)).toBe(false)
    expect(verifyQrCode('pz1', 1, code.slice(0, 15) + 'x', secret)).toBe(false)
    expect(verifyQrCode('pz1', 1, undefined, secret)).toBe(false)
  })
  it('fails closed with no secret', () => {
    expect(verifyQrCode('pz1', 1, 'aaaaaaaaaaaaaaaa', '')).toBe(false)
    expect(() => qrCodeFor('pz1', 1, '')).toThrow()
  })
  it('round-trips the path', () => {
    const code = qrCodeFor('pz1', 1, secret)
    const path = qrPath('some-place-town', code)
    expect(parseQrPath(path.replace('/passport/q/', ''))).toEqual({ slug: 'some-place-town', code })
    expect(parseQrPath('nodot')).toBeNull()
    expect(parseQrPath('Bad_Slug.' + code)).toBeNull()
    expect(parseQrPath('slug.short')).toBeNull()
  })
  it('slugifies', () => {
    expect(slugify('Café Più!', 'São Paulo')).toBe('cafe-piu-sao-paulo')
    expect(slugify('***')).toBe('pizzeria')
  })
})

describe('abuse', () => {
  const t0 = new Date('2026-11-01T12:00:00Z')
  it('flags impossible travel and allows plausible travel', () => {
    const ny = { ...VENUE, at: t0 }
    const london = { lat: 51.5074, lng: -0.1278, at: new Date(t0.getTime() + 10 * 60_000) }
    expect(isImpossibleTravel(ny, london, 900)).toBe(true)
    const later = { ...london, at: new Date(t0.getTime() + 10 * 3_600_000) }
    expect(isImpossibleTravel(ny, later, 900)).toBe(false)
    const nearby = { lat: VENUE.lat + 0.01, lng: VENUE.lng, at: new Date(t0.getTime() + 60_000) }
    expect(isImpossibleTravel(ny, nearby, 900)).toBe(false)
  })
  it('flags zero accuracy and round coordinates', () => {
    expect(isZeroAccuracy(0)).toBe(true)
    expect(isZeroAccuracy(12)).toBe(false)
    expect(hasRoundCoords({ lat: 40.71, lng: -74 })).toBe(true)
    expect(hasRoundCoords({ lat: 40.712834, lng: -74.006012 })).toBe(false)
    expect(hasRoundCoords({ lat: 40.7128, lng: -74.006 })).toBe(false)
  })
})

describe('check-in decision table', () => {
  const now = new Date('2026-11-01T18:00:00Z')
  const good = { lat: VENUE.lat + 0.0003, lng: VENUE.lng + 0.00031, accuracy: 20 }
  const base: DecisionInput = {
    disallowed: false,
    pizzeria: { isPartner: true, isChain: false, status: 'ACTIVE', ...VENUE },
    qrValid: true,
    client: good,
    config: { radiusM: 150, maxAccuracyM: 150, maxNewStampsPerDay: 5, revisitCooldownHours: 20, maxTravelKmPerHour: 900 },
    newAccount: false,
    previous: null,
    existing: null,
    newStampsLast24h: 0,
    now,
  }
  const run = (o: Partial<DecisionInput>) => decideCheckIn({ ...base, ...o })

  it('approves QR + nearby location as a new stamp', () => {
    const r = run({})
    expect(r.decision).toBe('APPROVED')
    expect(r.newStamp).toBe(true)
    expect(r.countsAsVisit).toBe(true)
    expect(r.method).toBe('QR')
    expect(r.distanceM).toBeLessThan(150)
    expect(r.riskFlags).toEqual([])
  })
  it('rejects disallowed members, non-partners, chains, inactive venues', () => {
    expect(run({ disallowed: true })).toMatchObject({ decision: 'REJECTED', reason: 'not_allowed' })
    expect(run({ pizzeria: { ...base.pizzeria, isPartner: false } })).toMatchObject({ reason: 'not_eligible' })
    expect(run({ pizzeria: { ...base.pizzeria, isChain: true } })).toMatchObject({ reason: 'not_eligible' })
    expect(run({ pizzeria: { ...base.pizzeria, status: 'HIDDEN' } })).toMatchObject({ reason: 'not_eligible' })
  })
  it('rejects a bad QR even with a perfect location', () => {
    expect(run({ qrValid: false })).toMatchObject({ decision: 'REJECTED', reason: 'bad_qr' })
  })
  it('rejects too far, low accuracy and malformed locations', () => {
    expect(run({ client: { lat: VENUE.lat + 0.05, lng: VENUE.lng, accuracy: 10 } })).toMatchObject({ reason: 'too_far' })
    expect(run({ client: { ...good, accuracy: 400 } })).toMatchObject({ reason: 'low_accuracy' })
    expect(run({ client: { lat: 'x', lng: 1, accuracy: 5 } })).toMatchObject({ reason: 'bad_location' })
    expect(run({ client: { lat: 1, lng: 2, accuracy: -1 } })).toMatchObject({ reason: 'bad_location' })
    expect(run({ client: { lat: 1, lng: 2, accuracy: undefined } })).toMatchObject({ reason: 'bad_location' })
  })
  it('respects the configured radius', () => {
    const farish = { lat: VENUE.lat + 0.002, lng: VENUE.lng, accuracy: 10 } // ~220 m
    expect(run({ client: farish })).toMatchObject({ reason: 'too_far' })
    expect(run({ client: farish, config: { ...base.config, radiusM: 300 } }).decision).toBe('APPROVED')
  })
  it('holds a valid QR with no location', () => {
    const r = run({ client: null })
    expect(r).toMatchObject({ decision: 'PENDING', method: 'QR_NO_GEO' })
    expect(r.riskFlags).toContain('no_geo')
  })
  it('holds new accounts, impossible travel, zero accuracy and round coordinates', () => {
    expect(run({ newAccount: true })).toMatchObject({ decision: 'PENDING' })
    const far = { lat: 51.5, lng: -0.12, at: new Date(now.getTime() - 10 * 60_000) }
    expect(run({ previous: far }).riskFlags).toContain('velocity')
    expect(run({ client: { ...good, accuracy: 0 } }).riskFlags).toContain('zero_accuracy')
    const round = run({ pizzeria: { ...base.pizzeria, lat: 40.71, lng: -74 }, client: { lat: 40.71, lng: -74, accuracy: 10 } })
    expect(round.riskFlags).toContain('round_coords')
    expect(round.decision).toBe('PENDING')
  })
  it('caps new stamps per day but not repeat visits', () => {
    expect(run({ newStampsLast24h: 5 })).toMatchObject({ decision: 'REJECTED', reason: 'daily_limit' })
    expect(run({ newStampsLast24h: 4 }).decision).toBe('APPROVED')
    const existing = { lastVisitAt: new Date(now.getTime() - 48 * 3_600_000) }
    expect(run({ newStampsLast24h: 5, existing }).decision).toBe('APPROVED')
  })
  it('counts a repeat visit only after the cooldown', () => {
    const within = run({ existing: { lastVisitAt: new Date(now.getTime() - 2 * 3_600_000) } })
    expect(within).toMatchObject({ decision: 'APPROVED', newStamp: false, countsAsVisit: false })
    const after = run({ existing: { lastVisitAt: new Date(now.getTime() - 21 * 3_600_000) } })
    expect(after).toMatchObject({ decision: 'APPROVED', newStamp: false, countsAsVisit: true })
  })
})

describe('visibility', () => {
  const now = new Date('2026-11-01T12:00:00Z')
  const rows = [
    { stampedAt: new Date('2026-11-01T11:00:00Z') },
    { stampedAt: new Date('2026-11-01T05:00:00Z') },
    { stampedAt: new Date('2026-10-01T05:00:00Z') },
  ]
  it('delays other viewers but not the owner', () => {
    expect(visibleStamps(rows, 'anonymous', 6, now)).toHaveLength(2)
    expect(visibleStamps(rows, 'member', 0, now)).toHaveLength(3)
    expect(visibleStamps(rows, 'owner', 6, now)).toHaveLength(3)
  })
  it('applies the visibility levels', () => {
    expect(canView('public', 'anonymous')).toBe(true)
    expect(canView('members', 'anonymous')).toBe(false)
    expect(canView('members', 'member')).toBe(true)
    expect(canView('private', 'member')).toBe(false)
    expect(canView('private', 'owner')).toBe(true)
  })
  it('defaults unknown values to public and gives month only', () => {
    expect(parseVisibility('weird')).toBe('public')
    expect(parseVisibility('private')).toBe('private')
    expect(monthOnly(new Date('2026-03-31T23:00:00Z'))).toBe('2026-03')
  })
})

describe('kill switch', () => {
  it('only the off values force it off', () => {
    expect(killSwitchOn({ PASSPORT_ENABLED: 'off' } as never)).toBe(true)
    expect(killSwitchOn({ PASSPORT_ENABLED: ' OFF ' } as never)).toBe(true)
    expect(killSwitchOn({ PASSPORT_ENABLED: '0' } as never)).toBe(true)
    expect(killSwitchOn({ PASSPORT_ENABLED: 'on' } as never)).toBe(false)
    expect(killSwitchOn({} as never)).toBe(false)
  })
})

describe('partner input', () => {
  it('requires a name and valid coordinates', () => {
    expect(parsePartner({}).ok).toBe(false)
    expect(parsePartner({ name: 'X', lat: 95, lng: 0 }).ok).toBe(false)
    expect(parsePartner({ name: 'X', lat: 1, lng: 2, countryCode: 'us' })).toMatchObject({ ok: true, value: { countryCode: 'US' } })
  })
  it('a logo needs consent and must be https', () => {
    expect(parsePartner({ name: 'X', logoUrl: 'https://e.test/l.png' }).ok).toBe(false)
    expect(parsePartner({ name: 'X', logoUrl: 'https://e.test/l.png', logoConsent: true }).ok).toBe(true)
    expect(parsePartner({ name: 'X', logoUrl: 'http://e.test/l.png', logoConsent: true }).ok).toBe(false)
  })
})

describe('stamp style', () => {
  it('is deterministic and bounded', () => {
    const a = stampStyle('42')
    expect(stampStyle('42')).toEqual(a)
    expect(a.rotate).toBeGreaterThanOrEqual(-10)
    expect(a.rotate).toBeLessThanOrEqual(10)
    expect(stampStyle('1', '#112233').ink).toBe('#112233')
    expect(stampStyle('1', 'red').ink).not.toBe('red')
  })
})
