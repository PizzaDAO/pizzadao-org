// @vitest-environment node
//
// Pending item grants (UnbelievaBoat carry-over): members without an app
// account get a PENDING ItemGrant that is credited on first login /
// onboarding. The real-Postgres exactly-once checks (parallel logins) live in
// pep-economy.concurrency.test.ts; this file covers planning, the dry-run
// report, and the credit / flag logic against a mocked client.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./db')

import { prisma } from './db'
import {
  applyGrant,
  creditPendingItemGrants,
  creditPendingItemGrantsOnLogin,
  formatGrantPlan,
  planGrants,
  type GrantPlanRow,
} from './shop-grants'

const mockFn = (f: unknown) => f as ReturnType<typeof vi.fn>
const MEMBER = '100000000000000001' // has an app account
const NEWBIE = '100000000000000002' // no User row yet
const HELD = '100000000000000003' // already has a PENDING grant

beforeEach(() => {
  vi.clearAllMocks()
  mockFn(prisma.shopItem.findMany).mockResolvedValue([
    { id: 1, name: 'Rare Pizza Box', isCollectible: false },
    { id: 2, name: 'Proof of Pizza', isCollectible: false },
    { id: 3, name: 'Pizza Sticks', isCollectible: false },
    { id: 9, name: 'Molto Benny Pin', isCollectible: true },
  ])
  mockFn(prisma.itemGrant.findMany).mockResolvedValue([
    { grantKey: `unbelievaboat:${HELD}:9`, quantity: 1, status: 'PENDING' },
    { grantKey: `unbelievaboat:${MEMBER}:2`, quantity: 1, status: 'CREDITED' },
  ])
  mockFn(prisma.user.findMany).mockResolvedValue([{ id: MEMBER }])
})

const rows = [
  { line: 2, discordId: MEMBER, item: 'Rare Pizza Box', qty: 1 },
  { line: 3, discordId: NEWBIE, item: 'molto benny pin', qty: 2 },
  { line: 4, discordId: HELD, item: 'Molto Benny Pin', qty: 1 },
  { line: 5, discordId: MEMBER, item: 'Proof of Pizza', qty: 1 },
  { line: 6, discordId: NEWBIE, item: 'Chicken', qty: 4 },
  { line: 7, discordId: NEWBIE, item: 'Pizza Sticks', qty: 3 },
]

describe('planGrants', () => {
  it('grants now for members with an account, holds for members without, skips Chicken', async () => {
    const plan = await planGrants(rows)
    expect(plan.map((p) => [p.line, p.status])).toEqual([
      [2, 'grant'],
      [3, 'hold'],
      [4, 'already_held'],
      [5, 'already_granted'],
      [6, 'not_carried_over'],
      [7, 'hold'],
    ])
    expect(plan[1]).toMatchObject({ itemId: 9, itemName: 'Molto Benny Pin', isCollectible: true, grantKey: `unbelievaboat:${NEWBIE}:9` })
    expect(prisma.user.findMany).toHaveBeenCalledWith({ where: { id: { in: [MEMBER, NEWBIE, HELD] } }, select: { id: true } })
  })
})

describe('formatGrantPlan (grant-items.mjs dry-run output)', () => {
  it('shows granted-now vs held-pending per row, then totals', async () => {
    const out = formatGrantPlan(await planGrants(rows))
    expect(out).toEqual([
      `  + line 2: ${MEMBER}  1 x Rare Pizza Box  [grant]  GRANT NOW -> inventory`,
      `  ~ line 3: ${NEWBIE}  2 x Molto Benny Pin (collectible)  [hold]  HOLD PENDING -> credited on first login/onboarding  (no app account yet)`,
      `  = line 4: ${HELD}  1 x Molto Benny Pin (collectible)  [already_held]  (still held until they sign up)`,
      `  = line 5: ${MEMBER}  1 x Proof of Pizza  [already_granted]`,
      `  - line 6: ${NEWBIE}  4 x Chicken  [not_carried_over]  (not carried over (owner decision); skipped)`,
      `  ~ line 7: ${NEWBIE}  3 x Pizza Sticks  [hold]  HOLD PENDING -> credited on first login/onboarding  (no app account yet)`,
      '',
      'Grant now: 1  hold pending signup: 2  already granted: 1  already held: 1  conflicts: 0  unknown items: 0  duplicates: 0  not carried over: 1',
    ])
  })
})

function txMock({ hasUser, inserted = 1 }: { hasUser: boolean; inserted?: number }) {
  const tx = {
    user: { findUnique: vi.fn().mockResolvedValue(hasUser ? { id: 'x' } : null) },
    itemGrant: { createMany: vi.fn().mockResolvedValue({ count: inserted }), findMany: vi.fn(), updateMany: vi.fn() },
    inventory: { upsert: vi.fn().mockResolvedValue({}) },
  }
  mockFn(prisma.$transaction).mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx))
  return tx
}

const planned = (over: Partial<GrantPlanRow>): GrantPlanRow => ({
  line: 1,
  discordId: NEWBIE,
  item: 'Pizza Sticks',
  qty: 3,
  itemId: 3,
  itemName: 'Pizza Sticks',
  grantKey: `unbelievaboat:${NEWBIE}:3`,
  status: 'hold',
  ...over,
})

describe('applyGrant', () => {
  it('holds (PENDING, no inventory) when the member has no account', async () => {
    const tx = txMock({ hasUser: false })
    expect(await applyGrant(planned({}))).toBe('held')
    expect(tx.itemGrant.createMany.mock.calls[0][0].data[0]).toMatchObject({ status: 'PENDING', creditedAt: null, quantity: 3 })
    expect(tx.inventory.upsert).not.toHaveBeenCalled()
  })

  it('credits straight into inventory when the member has signed up since the plan', async () => {
    const tx = txMock({ hasUser: true })
    expect(await applyGrant(planned({ status: 'hold' }))).toBe('credited')
    expect(tx.itemGrant.createMany.mock.calls[0][0].data[0]).toMatchObject({ status: 'CREDITED', creditedAt: expect.any(Date) })
    expect(tx.inventory.upsert).toHaveBeenCalledWith({
      where: { userId_itemId: { userId: NEWBIE, itemId: 3 } },
      create: { userId: NEWBIE, itemId: 3, quantity: 3 },
      update: { quantity: { increment: 3 } },
    })
  })

  it('is idempotent through grantKey and never applies non-grant rows', async () => {
    const tx = txMock({ hasUser: true, inserted: 0 })
    expect(await applyGrant(planned({ status: 'grant' }))).toBe(false)
    expect(tx.inventory.upsert).not.toHaveBeenCalled()
    for (const status of ['already_granted', 'already_held', 'conflict', 'not_carried_over'] as const) {
      expect(await applyGrant(planned({ status }))).toBe(false)
    }
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
  })
})

describe('creditPendingItemGrants', () => {
  it('skips the transaction when nothing is held', async () => {
    mockFn(prisma.itemGrant.count).mockResolvedValue(0)
    expect(await creditPendingItemGrants(NEWBIE)).toEqual({ credited: 0, items: [] })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('claims each PENDING grant conditionally and credits only the ones it won', async () => {
    mockFn(prisma.itemGrant.count).mockResolvedValue(2)
    const tx = txMock({ hasUser: true })
    tx.itemGrant.findMany.mockResolvedValue([
      { id: 10, grantKey: 'k10', itemId: 9, quantity: 2 },
      { id: 11, grantKey: 'k11', itemId: 3, quantity: 3 },
    ])
    tx.itemGrant.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }) // k11 lost to a parallel login
    const r = await creditPendingItemGrants(NEWBIE)
    expect(r).toEqual({ credited: 1, items: [{ grantKey: 'k10', itemId: 9, quantity: 2 }] })
    expect(tx.itemGrant.findMany).toHaveBeenCalledWith({ where: { discordId: NEWBIE, status: 'PENDING' }, orderBy: { id: 'asc' } })
    expect(tx.itemGrant.updateMany).toHaveBeenNthCalledWith(1, { where: { id: 10, status: 'PENDING' }, data: { status: 'CREDITED', creditedAt: expect.any(Date) } })
    expect(tx.inventory.upsert).toHaveBeenCalledTimes(1)
    expect(tx.inventory.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { userId: NEWBIE, itemId: 9, quantity: 2 } }))
  })
})

describe('creditPendingItemGrantsOnLogin', () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it('runs by default, independent of PEP_MIGRATION_CLAIMS', async () => {
    delete process.env.ITEM_GRANT_CLAIMS
    delete process.env.PEP_MIGRATION_CLAIMS
    mockFn(prisma.itemGrant.count).mockResolvedValue(0)
    await creditPendingItemGrantsOnLogin(NEWBIE)
    expect(prisma.itemGrant.count).toHaveBeenCalledWith({ where: { discordId: NEWBIE, status: 'PENDING' } })
  })

  it('is paused by ITEM_GRANT_CLAIMS=0', async () => {
    process.env.ITEM_GRANT_CLAIMS = '0'
    await creditPendingItemGrantsOnLogin(NEWBIE)
    expect(prisma.itemGrant.count).not.toHaveBeenCalled()
  })

  it('never throws (e.g. migration not deployed yet)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFn(prisma.itemGrant.count).mockRejectedValue(new Error('column "status" does not exist'))
    await expect(creditPendingItemGrantsOnLogin(NEWBIE)).resolves.toBeUndefined()
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})
