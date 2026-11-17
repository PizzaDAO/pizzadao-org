// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => ({
  memberProfileExtras: { findUnique: vi.fn(), findMany: vi.fn() },
  memberRsvEvent: { deleteMany: vi.fn(async (a: unknown) => ({ op: 'delete', a })), createMany: vi.fn(async (a: unknown) => ({ op: 'create', a })) },
  memberRsvCheck: { deleteMany: vi.fn(async (a: unknown) => ({ op: 'delCheck', a })), upsert: vi.fn(async (a: unknown) => ({ op: 'upsert', a })), findMany: vi.fn() },
  memberWallet: { findMany: vi.fn() },
  $transaction: vi.fn(async (arg: unknown) => (typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(db) : Promise.all(arg as unknown[]))),
}))
vi.mock('@/app/lib/db', () => ({ prisma: db }))
const cfg = vi.hoisted(() => ({ enabled: true }))
vi.mock('./config', () => ({ loadEventsAttendedConfig: vi.fn(async () => ({ enabled: cfg.enabled, rsvRecheckDays: 7, rsvApiUrl: 'https://api.rsv.example' })) }))
const client = vi.hoisted(() => ({ fetchGuestAttendance: vi.fn() }))
vi.mock('./guest-attendance', async (orig) => ({ ...(await orig<typeof import('./guest-attendance')>()), fetchGuestAttendance: client.fetchGuestAttendance }))

import { clearEmailMatches, clearWalletMatches, collectIdentifiers, hashEmail, listDueMembers, refreshRsvEvents, refreshRsvEventsIfEnabled } from './rsv'
import { emailHash } from '@/app/lib/telegram/host-match'

const W = '0x' + '2'.repeat(40)
const ev = (id: string, matchedBy: 'email' | 'wallet' = 'email', guestListHidden = false) => ({ id, name: `P ${id}`, date: '2026-05-22', city: 'Rome', url: `https://rsv.pizza/${id}`, matchedBy, guestListHidden })

beforeEach(() => {
  vi.clearAllMocks()
  cfg.enabled = true
  db.memberProfileExtras.findUnique.mockResolvedValue({ email: 'A@x.io', emailVerifiedAt: new Date(), rsvLinkedEmailHash: null })
  db.memberWallet.findMany.mockResolvedValue([])
})

describe('collectIdentifiers', () => {
  it('sends no hash for an unverified email', async () => {
    db.memberProfileExtras.findUnique.mockResolvedValue({ email: 'a@x.io', emailVerifiedAt: null, rsvLinkedEmailHash: null })
    expect((await collectIdentifiers('1')).hashes).toEqual([])
  })
  it('hashes a verified email like the host-match contract', async () => {
    expect((await collectIdentifiers('1')).hashes).toEqual([emailHash('a@x.io')])
    expect(hashEmail(' A@X.io ')).toBe(emailHash('a@x.io'))
  })
  it('adds the linked rsv.pizza hash, deduplicated', async () => {
    db.memberProfileExtras.findUnique.mockResolvedValue({ email: 'a@x.io', emailVerifiedAt: new Date(), rsvLinkedEmailHash: 'c'.repeat(64) })
    expect((await collectIdentifiers('1')).hashes).toEqual([emailHash('a@x.io'), 'c'.repeat(64)])
    db.memberProfileExtras.findUnique.mockResolvedValue({ email: 'a@x.io', emailVerifiedAt: new Date(), rsvLinkedEmailHash: emailHash('a@x.io') })
    expect((await collectIdentifiers('1')).hashes).toHaveLength(1)
  })
  it('uses only the linked hash when the email is not verified', async () => {
    db.memberProfileExtras.findUnique.mockResolvedValue({ email: 'a@x.io', emailVerifiedAt: null, rsvLinkedEmailHash: 'c'.repeat(64) })
    expect((await collectIdentifiers('1')).hashes).toEqual(['c'.repeat(64)])
  })
})

describe('refreshRsvEvents', () => {
  it('replaces the stored rows and the check marker in one transaction', async () => {
    db.memberWallet.findMany.mockResolvedValue([{ walletAddress: W }])
    client.fetchGuestAttendance.mockResolvedValue([ev('a'), ev('b', 'wallet')])
    expect(await refreshRsvEvents('1')).toEqual({ ok: true, count: 2 })
    expect(client.fetchGuestAttendance).toHaveBeenCalledWith({ emailHashes: [emailHash('a@x.io')], wallets: [W] }, expect.objectContaining({ baseUrl: 'https://api.rsv.example' }))
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(db.memberRsvEvent.deleteMany).toHaveBeenCalledWith({ where: { memberId: '1' } })
    expect(db.memberRsvEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }))
    expect(db.memberRsvCheck.upsert).toHaveBeenCalled()
  })
  it('sends the profile-email hash and the linked hash together in one call, de-duplicating events', async () => {
    db.memberProfileExtras.findUnique.mockResolvedValue({ email: 'a@x.io', emailVerifiedAt: new Date(), rsvLinkedEmailHash: 'c'.repeat(64) })
    client.fetchGuestAttendance.mockResolvedValue([ev('a'), ev('a'), ev('z')])
    expect(await refreshRsvEvents('1')).toEqual({ ok: true, count: 2 })
    expect(client.fetchGuestAttendance).toHaveBeenCalledTimes(1)
    expect(client.fetchGuestAttendance.mock.calls[0][0].emailHashes).toEqual([emailHash('a@x.io'), 'c'.repeat(64)])
  })
  it('keeps the old rows when the call fails', async () => {
    client.fetchGuestAttendance.mockResolvedValue(null)
    expect(await refreshRsvEvents('1')).toEqual({ ok: false })
    expect(db.$transaction).not.toHaveBeenCalled()
  })
  it('clears everything when the member has no identifiers left', async () => {
    db.memberProfileExtras.findUnique.mockResolvedValue({ email: null, emailVerifiedAt: null, rsvLinkedEmailHash: null })
    expect(await refreshRsvEvents('1')).toEqual({ ok: true, count: 0 })
    expect(client.fetchGuestAttendance).not.toHaveBeenCalled()
    expect(db.memberRsvEvent.deleteMany).toHaveBeenCalledWith({ where: { memberId: '1' } })
  })
})

describe('refresh races', () => {
  it('writes nothing when the identifiers changed while rsv.pizza was being asked', async () => {
    client.fetchGuestAttendance.mockImplementation(async () => {
      // the member removed their email during the call
      db.memberProfileExtras.findUnique.mockResolvedValue({ email: null, emailVerifiedAt: null, rsvLinkedEmailHash: null })
      return [ev('a')]
    })
    expect(await refreshRsvEvents('1')).toEqual({ ok: false })
    expect(db.memberRsvEvent.createMany).not.toHaveBeenCalled()
    expect(db.memberRsvEvent.deleteMany).not.toHaveBeenCalled()
  })
  it('does not wipe the rows if an identifier appeared meanwhile', async () => {
    let n = 0
    db.memberProfileExtras.findUnique.mockImplementation(async () => (n++ === 0 ? { email: null, emailVerifiedAt: null, rsvLinkedEmailHash: null } : { email: 'a@x.io', emailVerifiedAt: new Date(), rsvLinkedEmailHash: null }))
    await refreshRsvEvents('1')
    expect(db.memberRsvEvent.deleteMany).not.toHaveBeenCalled()
  })
})

describe('refreshRsvEventsIfEnabled', () => {
  it('does nothing while the feature is off, and never throws', async () => {
    cfg.enabled = false
    await refreshRsvEventsIfEnabled('1')
    expect(client.fetchGuestAttendance).not.toHaveBeenCalled()
    cfg.enabled = true
    db.memberProfileExtras.findUnique.mockRejectedValue(new Error('db down'))
    await expect(refreshRsvEventsIfEnabled('1')).resolves.toBeUndefined()
  })
})

describe('clearWalletMatches', () => {
  it('deletes only wallet-matched rows (email-matched rows stay) and resets the check marker', async () => {
    await clearWalletMatches('1')
    expect(db.memberRsvEvent.deleteMany).toHaveBeenCalledWith({ where: { memberId: '1', matchedBy: 'wallet' } })
    expect(db.memberRsvCheck.deleteMany).toHaveBeenCalledWith({ where: { memberId: '1' } })
  })
})

describe('clearEmailMatches', () => {
  it('deletes only email-matched rows (wallet rows stay) and the check marker', async () => {
    await clearEmailMatches('1')
    expect(db.memberRsvEvent.deleteMany).toHaveBeenCalledWith({ where: { memberId: '1', matchedBy: 'email' } })
    expect(db.memberRsvCheck.deleteMany).toHaveBeenCalledWith({ where: { memberId: '1' } })
  })
})

describe('listDueMembers', () => {
  it('lists members with an identifier whose last check is stale, oldest first, within the limit', async () => {
    const now = new Date('2026-11-17T00:00:00Z')
    db.memberProfileExtras.findMany.mockResolvedValue([{ memberId: 'a' }, { memberId: 'b' }])
    db.memberWallet.findMany.mockResolvedValue([{ memberId: 'b' }, { memberId: 'c' }, { memberId: 'd' }])
    db.memberRsvCheck.findMany.mockResolvedValue([
      { memberId: 'a', checkedAt: new Date('2026-11-16T00:00:00Z') }, // fresh
      { memberId: 'b', checkedAt: new Date('2026-10-01T00:00:00Z') }, // stale
    ])
    expect(await listDueMembers(7, 10, now)).toEqual(['c', 'd', 'b']) // never-checked first
    expect(await listDueMembers(7, 1, now)).toHaveLength(1)
  })
})
