// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => ({
  unlockLock: { findMany: vi.fn() },
  unlockKey: { findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  unlockScanState: { upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
  memberWallet: { findMany: vi.fn(), count: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock('@/app/lib/db', () => ({ prisma: db }))
vi.mock('@/app/lib/settings', () => ({ getSetting: vi.fn(async () => 24) }))
const fetchKeys = vi.fn()
vi.mock('./subgraph', async (orig) => ({ ...(await orig<typeof import('./subgraph')>()), fetchKeys: (...a: unknown[]) => fetchKeys(...a) }))

import { buildOwnerMap, isStale, planKeys, rescanWaitSeconds, scanMembers, sortEvents, type ExistingKey, type FoundKey } from './scan'

const W1 = '0x' + '1'.repeat(40)
const W2 = '0x' + '2'.repeat(40)
const L1 = '0x' + 'a'.repeat(40)
const L2 = '0x' + 'b'.repeat(40)

const found = (over: Partial<FoundKey> = {}): FoundKey => ({ networkId: 8453, lockAddress: L1, tokenId: '1', owner: W1, memberId: 'm1', ...over })
const have = (over: Partial<ExistingKey> = {}): ExistingKey => ({ id: 1, memberId: 'm1', networkId: 8453, lockAddress: L1, tokenId: '1', owner: W1, gone: false, ...over })

beforeEach(() => {
  vi.clearAllMocks()
  db.$transaction.mockImplementation(async (ops: unknown[]) => Promise.all(ops))
  db.unlockLock.findMany.mockResolvedValue([{ networkId: 8453, address: L1 }])
  db.memberWallet.findMany.mockResolvedValue([{ id: 1, memberId: 'm1', walletAddress: W1.toUpperCase().replace('0X', '0x') }])
  db.unlockKey.findMany.mockResolvedValue([])
  db.unlockKey.createMany.mockResolvedValue({ count: 0 })
  db.unlockKey.updateMany.mockResolvedValue({ count: 0 })
  db.unlockScanState.upsert.mockResolvedValue({})
  db.unlockScanState.update.mockResolvedValue({})
  db.unlockScanState.updateMany.mockResolvedValue({ count: 1 })
})

describe('buildOwnerMap', () => {
  it('lowercases, drops non-EVM junk, and gives a shared wallet to the first member', () => {
    const m = buildOwnerMap(
      [
        { id: 2, memberId: 'm2', walletAddress: W1 },
        { id: 1, memberId: 'm1', walletAddress: W1.toUpperCase().replace('0X', '0x') },
        { id: 3, memberId: 'm1', walletAddress: 'So1anaAddress' },
      ],
      [{ memberId: 'm3', wallet: W2 }],
    )
    expect([...m.entries()]).toEqual([[W1, 'm1'], [W2, 'm3']])
  })
})

describe('planKeys', () => {
  const locks = new Set([`8453:${L1}`])
  it('creates new keys, touches seen ones, and marks missing ones gone', () => {
    const plan = planKeys(
      [have({ id: 1 }), have({ id: 2, tokenId: '2' }), have({ id: 3, tokenId: '3', gone: true })],
      [found(), found({ tokenId: '3' }), found({ tokenId: '9' })],
      new Set(['m1']),
      locks,
    )
    expect(plan.create.map((k) => k.tokenId)).toEqual(['9'])
    expect(plan.touchIds.sort()).toEqual([1, 3])
    expect(plan.goneIds).toEqual([2])
  })

  it('does not mark gone keys on locks that were not scanned (disabled) or other members', () => {
    const plan = planKeys([have({ id: 1, lockAddress: L2 }), have({ id: 2, memberId: 'm9', tokenId: '2' })], [], new Set(['m1']), locks)
    expect(plan.goneIds).toEqual([])
  })

  it('reassigns a key that moved to another member', () => {
    const plan = planKeys([have({ id: 1, memberId: 'm1' })], [found({ memberId: 'm2' })], new Set(['m2']), locks)
    expect(plan.reassign).toEqual([{ id: 1, memberId: 'm2' }])
  })

  it('counts a repeated key once', () => {
    expect(planKeys([], [found(), found()], new Set(['m1']), locks).create).toHaveLength(1)
  })
})

describe('scanMembers', () => {
  it('failed subgraph read throws and persists NO keys, counts or gone-marks', async () => {
    fetchKeys.mockRejectedValue(new Error('deployment does not exist'))
    db.unlockKey.findMany.mockResolvedValue([have()]) // an existing ticket must survive an outage
    await expect(scanMembers(['m1'])).rejects.toThrow('deployment does not exist')
    expect(db.unlockKey.createMany).not.toHaveBeenCalled()
    expect(db.unlockKey.updateMany).not.toHaveBeenCalled()
    expect(db.unlockKey.update).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(db.unlockScanState.update).not.toHaveBeenCalled()
    expect(db.unlockScanState.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { lastError: 'deployment does not exist' } }))
  })

  it('upserts found keys, marks transferred-away keys gone, and stores the count', async () => {
    fetchKeys.mockResolvedValue([{ id: 'k', owner: W1.toUpperCase().replace('0X', '0x'), tokenId: '7', expiration: '0', cancelled: false, lock: { id: L1.toUpperCase().replace('0X', '0x') } }])
    db.unlockKey.findMany
      .mockResolvedValueOnce([have({ id: 5, tokenId: '8' })]) // existing, no longer held
      .mockResolvedValueOnce([{ memberId: 'm1', networkId: 8453, lockAddress: L1 }]) // live after write
    const r = await scanMembers(['m1'])
    expect(r).toMatchObject({ created: 1, gone: 1, wallets: 1 })
    expect(db.unlockKey.createMany).toHaveBeenCalledWith({ data: [found({ tokenId: '7' })], skipDuplicates: true })
    expect(db.unlockKey.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: [5] } }, data: expect.objectContaining({ gone: true }) }))
    expect(db.unlockScanState.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ticketCount: 1, lastError: null }) }))
    expect(fetchKeys).toHaveBeenCalledWith(8453, [W1], [L1])
  })

  it('ignores cancelled keys and passes extra (SIWE) wallets', async () => {
    fetchKeys.mockResolvedValue([{ id: 'k', owner: W2, tokenId: '1', expiration: '0', cancelled: true, lock: { id: L1 } }])
    const r = await scanMembers(['m1'], [{ memberId: 'm1', wallet: W2 }])
    expect(fetchKeys.mock.calls[0][1]).toEqual([W1, W2])
    expect(r.found).toBe(0)
  })
})

describe('freshness and rate limit', () => {
  const now = new Date('2026-11-09T12:00:00Z')
  const ago = (min: number) => new Date(now.getTime() - min * 60_000)
  it('stale after the interval, fresh before, never-scanned is stale', () => {
    expect(isStale(null, 24, now)).toBe(true)
    expect(isStale({ lastScanAt: ago(60), lastAttemptAt: ago(60) }, 24, now)).toBe(false)
    expect(isStale({ lastScanAt: ago(25 * 60), lastAttemptAt: ago(25 * 60) }, 24, now)).toBe(true)
  })
  it('does not retry within 10 minutes of an attempt (failed scans do not stampede)', () => {
    expect(isStale({ lastScanAt: null, lastAttemptAt: ago(3) }, 24, now)).toBe(false)
  })
  it('rescan wait counts down the cooldown', () => {
    expect(rescanWaitSeconds(null, 10, now)).toBe(0)
    expect(rescanWaitSeconds({ lastScanAt: null, lastAttemptAt: ago(4) }, 10, now)).toBe(360)
    expect(rescanWaitSeconds({ lastScanAt: null, lastAttemptAt: ago(11) }, 10, now)).toBe(0)
  })
})

describe('sortEvents', () => {
  it('newest year first, unknown last, then name', () => {
    const e = (name: string, year: number | null) => ({ networkId: 1, lockAddress: name, name, year, count: 1, url: null })
    expect(sortEvents([e('B', 2024), e('X', null), e('A', 2025), e('C', 2025)]).map((x) => x.name)).toEqual(['A', 'C', 'B', 'X'])
  })
})
