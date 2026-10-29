// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => {
  const tx: Record<string, any> = {
    $executeRaw: vi.fn(async () => 1),
    passportStamp: { findUnique: vi.fn(), count: vi.fn(), upsert: vi.fn(async () => ({})) },
    pizzeriaCheckIn: { findUnique: vi.fn(), create: vi.fn(async () => ({ id: 9 })), update: vi.fn(async () => ({})), updateMany: vi.fn() },
  }
  const prisma: Record<string, any> = { ...tx, $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)), pizzeria: { findUnique: vi.fn() } }
  return { tx, prisma }
})
vi.mock('@/app/lib/db', () => ({ prisma: db.prisma }))
vi.mock('@/app/lib/member-utils', () => ({ findMemberIdByDiscordId: vi.fn(async () => null) }))
vi.mock('@/app/lib/disavow/constants', () => ({ disavowEnabled: () => false }))
vi.mock('@/app/lib/disavow/access', () => ({ isDisavowSubject: vi.fn(async () => false) }))

import { reviewCheckIn, performCheckIn } from './stamps'
import { scrubCoordinates } from './scrub'
import { qrCodeFor } from './qr'
import { snowflakeAt } from '@/app/lib/mission-verify/policy'

const now = new Date('2026-11-10T12:00:00Z')
const cfg = { revisitCooldownHours: 20, maxNewStampsPerDay: 5 }

beforeEach(() => {
  vi.clearAllMocks()
  db.tx.passportStamp.findUnique.mockResolvedValue(null)
  db.tx.passportStamp.count.mockResolvedValue(0)
})

describe('scrubCoordinates', () => {
  it('nulls lat/lng on check-ins older than 30 days only', async () => {
    db.tx.pizzeriaCheckIn.updateMany.mockResolvedValue({ count: 3 })
    expect(await scrubCoordinates(now)).toBe(3)
    const arg = db.tx.pizzeriaCheckIn.updateMany.mock.calls[0][0]
    expect(arg.data).toEqual({ lat: null, lng: null })
    expect(arg.where.createdAt.lt).toEqual(new Date('2026-10-11T12:00:00Z'))
  })
})

describe('reviewCheckIn approval', () => {
  const held = (over = {}) => ({
    id: 4,
    status: 'PENDING',
    discordId: '1',
    memberId: null,
    pizzeriaId: 'pz',
    pizzeria: { status: 'ACTIVE', isPartner: true, isChain: false },
    ...over,
  })

  it('does not count a revisit inside the cooldown, and counts one after it', async () => {
    db.tx.pizzeriaCheckIn.findUnique.mockResolvedValue(held())
    db.tx.passportStamp.findUnique.mockResolvedValue({ lastVisitAt: new Date(now.getTime() - 2 * 3_600_000) })
    await reviewCheckIn(4, 'admin', true, cfg, now)
    expect(db.tx.passportStamp.upsert.mock.calls[0][0].update).toEqual({})

    db.tx.passportStamp.findUnique.mockResolvedValue({ lastVisitAt: new Date(now.getTime() - 25 * 3_600_000) })
    await reviewCheckIn(4, 'admin', true, cfg, now)
    expect(db.tx.passportStamp.upsert.mock.calls[1][0].update).toMatchObject({ visits: { increment: 1 } })
  })

  it('re-counts the daily cap inside the transaction, under the member lock', async () => {
    db.tx.pizzeriaCheckIn.findUnique.mockResolvedValue(held())
    db.tx.passportStamp.count.mockResolvedValue(5)
    const r = await reviewCheckIn(4, 'admin', true, cfg, now)
    expect(r).toEqual({ ok: false, reason: 'daily_limit' })
    expect(db.tx.$executeRaw).toHaveBeenCalled()
    expect(db.tx.passportStamp.upsert).not.toHaveBeenCalled()
  })

  it('refuses when the venue is no longer active', async () => {
    db.tx.pizzeriaCheckIn.findUnique.mockResolvedValue(held({ pizzeria: { status: 'HIDDEN', isPartner: true, isChain: false } }))
    expect(await reviewCheckIn(4, 'admin', true, cfg, now)).toEqual({ ok: false, reason: 'not_eligible' })
  })

  it('rejecting clears coordinates', async () => {
    db.tx.pizzeriaCheckIn.findUnique.mockResolvedValue(held())
    await reviewCheckIn(4, 'admin', false, cfg, now)
    expect(db.tx.pizzeriaCheckIn.update.mock.calls[0][0].data).toMatchObject({ status: 'REJECTED', lat: null, lng: null })
  })
})

describe('performCheckIn cooldown', () => {
  it('records a flagged in-cooldown revisit as a coordinate-free REJECTED row with its flags', async () => {
    process.env.PASSPORT_QR_SECRET = 's3cret'
    db.prisma.pizzeria.findUnique.mockResolvedValue({ id: 'pz', slug: 'a-b', name: 'A', city: null, countryCode: null, isPartner: true, isChain: false, status: 'ACTIVE', lat: 40.7128, lng: -74.006, qrVersion: 1 })
    db.prisma.passportStamp.findUnique.mockResolvedValue({ lastVisitAt: new Date(now.getTime() - 3_600_000) })
    db.prisma.passportStamp.count.mockResolvedValue(0)
    db.prisma.pizzeriaCheckIn.findFirst = vi.fn(async () => null)
    // discord id '1' is not a real snowflake, so the account is flagged new_account
    const r = await performCheckIn(
      { discordId: '1', slug: 'a-b', code: qrCodeFor('pz', 1, 's3cret'), client: { lat: 40.71283, lng: -74.00601, accuracy: 15 } },
      { enabled: true, radiusM: 150, maxAccuracyM: 150, maxNewStampsPerDay: 5, revisitCooldownHours: 20, publicDelayHours: 6, maxTravelKmPerHour: 900, newAccountDays: 30 },
      now,
    )
    expect(r).toMatchObject({ ok: true, decision: 'APPROVED', countsAsVisit: false })
    const data = db.prisma.pizzeriaCheckIn.create.mock.calls.at(-1)![0].data
    expect(data).toMatchObject({ status: 'REJECTED', lat: null, lng: null })
    expect(data.riskFlags).toContain('cooldown')
    expect(data.riskFlags).toContain('new_account')
  })
})

describe('performCheckIn', () => {
  const secret = 's3cret'
  const config = {
    enabled: true, radiusM: 150, maxAccuracyM: 150, maxNewStampsPerDay: 5, revisitCooldownHours: 20,
    publicDelayHours: 6, maxTravelKmPerHour: 900, newAccountDays: 30,
  }
  const venue = { id: 'pz', slug: 'a-b', name: 'A', city: null, countryCode: null, isPartner: true, isChain: false, status: 'ACTIVE', lat: 40.7128, lng: -74.006, qrVersion: 1 }
  const discordId = snowflakeAt(new Date('2020-01-01T00:00:00Z'))
  const req = () => ({
    discordId,
    slug: 'a-b',
    code: qrCodeFor('pz', 1, secret),
    client: { lat: 40.71283, lng: -74.00601, accuracy: 15 },
  })

  beforeEach(() => {
    process.env.PASSPORT_QR_SECRET = secret
    db.prisma.pizzeria.findUnique.mockResolvedValue(venue)
    db.prisma.passportStamp.findUnique.mockResolvedValue(null)
    db.prisma.passportStamp.count.mockResolvedValue(0)
    db.prisma.pizzeriaCheckIn.findFirst = vi.fn(async () => null)
  })

  it('re-counts the cap at grant time: a stale pre-check does not let a 6th stamp through', async () => {
    db.tx.passportStamp.count.mockResolvedValueOnce(0).mockResolvedValue(5) // a parallel request got there first
    const r = await performCheckIn(req(), config, now)
    expect(r).toEqual({ ok: false, reason: 'daily_limit' })
    expect(db.tx.passportStamp.upsert).not.toHaveBeenCalled()
    expect(db.tx.pizzeriaCheckIn.create.mock.calls[0][0].data).toMatchObject({ status: 'REJECTED', lat: null, lng: null })
  })

  it('grants a stamp when under the cap and stores no coordinates on a refusal', async () => {
    const ok = await performCheckIn(req(), config, now)
    expect(ok).toMatchObject({ ok: true, decision: 'APPROVED', newStamp: true })

    const far = await performCheckIn({ ...req(), client: { lat: 41.7, lng: -74, accuracy: 10 } }, config, now)
    expect(far).toEqual({ ok: false, reason: 'too_far' })
    const rejected = db.prisma.pizzeriaCheckIn.create.mock.calls.at(-1)![0].data
    expect(rejected).toMatchObject({ status: 'REJECTED', lat: null, lng: null })
    expect(rejected.distanceM).toBeGreaterThan(150)
  })

  it('bounds the previous-location lookup to the 30-day retention window', async () => {
    await performCheckIn(req(), config, now)
    const where = (db.prisma.pizzeriaCheckIn.findFirst as ReturnType<typeof vi.fn>).mock.calls[0][0].where
    expect(where.createdAt.gte).toEqual(new Date('2026-10-11T12:00:00Z'))
  })
})
