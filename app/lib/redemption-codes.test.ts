// @vitest-environment node
//
// Redemption codes (plans/proof-of-pizza-codes.md) against an in-memory fake of the few Prisma calls
// the module uses. The real-Postgres invariants (advisory locks, parallel buy/redeem/send) are covered
// by the local concurrency suite; this file pins the logic.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = {
  id: number
  code: string
  itemId: number
  discordId: string
  status: 'ACTIVE' | 'REDEEMED' | 'VOID'
  acquiredAt: Date
  redeemedAt: Date | null
  redeemedRef: string | null
  voidedAt: Date | null
  voidReason: string | null
  dmSentAt: Date | null
}

const ITEM = 7
const settings: Record<string, unknown> = { 'proofOfPizza.itemId': ITEM, 'proofOfPizza.siteUrl': 'https://proofof.pizza' }
let codes: Row[] = []
let inv = new Map<string, number>()
let nextId = 1

const match = (r: Row, where: Record<string, unknown> = {}) =>
  Object.entries(where).every(([k, v]) => {
    const val = (r as unknown as Record<string, unknown>)[k]
    if (v && typeof v === 'object' && 'in' in (v as object)) return ((v as { in: unknown[] }).in).includes(val)
    return val === v
  })

const tx = {
  $executeRaw: vi.fn().mockResolvedValue(1),
  inventory: {
    findUnique: vi.fn(async ({ where }: { where: { userId_itemId: { userId: string; itemId: number } } }) => {
      const q = inv.get(`${where.userId_itemId.userId}:${where.userId_itemId.itemId}`)
      return q === undefined ? null : { quantity: q }
    }),
    updateMany: vi.fn(async ({ where, data }: { where: { userId: string; itemId: number; quantity: { gte: number } }; data: { quantity: { decrement: number } } }) => {
      const k = `${where.userId}:${where.itemId}`
      const q = inv.get(k)
      if (q === undefined || q < where.quantity.gte) return { count: 0 }
      inv.set(k, q - data.quantity.decrement)
      return { count: 1 }
    }),
    deleteMany: vi.fn(async ({ where }: { where: { userId: string; itemId: number; quantity: { lte: number } } }) => {
      const k = `${where.userId}:${where.itemId}`
      if ((inv.get(k) ?? 1) <= where.quantity.lte) inv.delete(k)
      return { count: 1 }
    }),
  },
  redemptionCode: {
    findMany: vi.fn(async ({ where, orderBy }: { where?: Record<string, unknown>; orderBy?: { id?: 'asc' | 'desc' } }) => {
      const rows = codes.filter((r) => match(r, where))
      return orderBy?.id === 'desc' ? [...rows].reverse() : [...rows]
    }),
    findUnique: vi.fn(async ({ where }: { where: { code: string } }) => codes.find((r) => r.code === where.code) ?? null),
    createMany: vi.fn(async ({ data }: { data: Array<{ code: string; itemId: number; discordId: string; acquiredAt?: Date }> }) => {
      let count = 0
      for (const d of data) {
        if (codes.some((r) => r.code === d.code)) continue
        codes.push({ id: nextId++, status: 'ACTIVE', acquiredAt: d.acquiredAt ?? new Date(), redeemedAt: null, redeemedRef: null, voidedAt: null, voidReason: null, dmSentAt: null, ...d })
        count++
      }
      return { count }
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
      const rows = codes.filter((r) => match(r, where))
      rows.forEach((r) => Object.assign(r, data))
      return { count: rows.length }
    }),
  },
}

vi.mock('./db', () => ({
  prisma: {
    $transaction: async (fn: (t: unknown) => unknown) => fn(tx),
    redemptionCode: { findMany: (a: unknown) => tx.redemptionCode.findMany(a as never) },
  },
}))
vi.mock('./settings', () => ({ getSetting: async (k: string) => settings[k] }))
vi.mock('./shop-admin-people', () => ({ labelPeople: async (ids: string[]) => Object.fromEntries(ids.map((i) => [i, { name: `Name ${i}` }])) }))

import { CODE_ALPHABET, generateCode, getMyCodes, lookupCode, normalizeCode, normalizeRef, reconcileRedemptionCodes, redeemCode } from './redemption-codes'

const ALICE = '100000000000000001'
const BOB = '100000000000000002'
const active = (u: string) => codes.filter((r) => r.discordId === u && r.status === 'ACTIVE')

beforeEach(() => {
  codes = []
  inv = new Map()
  nextId = 1
  settings['proofOfPizza.itemId'] = ITEM
  vi.clearAllMocks()
})

describe('code format', () => {
  it('uses an unambiguous 31-character alphabet and 4-character codes', () => {
    expect(CODE_ALPHABET).toHaveLength(31)
    for (const bad of ['0', 'O', '1', 'I', 'L']) expect(CODE_ALPHABET).not.toContain(bad)
    for (let i = 0; i < 200; i++) expect(generateCode()).toMatch(/^[2-9A-HJKMNP-Z]{4}$/)
  })
  it('normalizes input and rejects malformed codes', () => {
    expect(normalizeCode(' ab-c 2 ')).toBe('ABC2')
    expect(normalizeCode('ab23')).toBe('AB23')
    for (const bad of ['AB2', 'AB234', 'AB0C', 'ABIL', '', null, 42, undefined, 'AB 2$']) expect(normalizeCode(bad)).toBeNull()
  })
  it('prefixes and bounds the submission ref', () => {
    expect(normalizeRef('cmabc123')).toBe('proofofpizza:cmabc123')
    for (const bad of ['', 'a b', 'x'.repeat(65), null, 5, 'a:b']) expect(normalizeRef(bad)).toBeNull()
  })
})

describe('reconcileRedemptionCodes', () => {
  it('mints one code per held unit, and nothing more on a second run', async () => {
    inv.set(`${ALICE}:${ITEM}`, 3)
    const r = await reconcileRedemptionCodes(tx, ALICE)
    expect(r.minted).toHaveLength(3)
    expect(new Set(r.minted).size).toBe(3)
    expect(active(ALICE)).toHaveLength(3)
    expect(await reconcileRedemptionCodes(tx, ALICE)).toEqual({ minted: [], voided: 0 })
  })

  it('takes the per-member advisory lock', async () => {
    inv.set(`${ALICE}:${ITEM}`, 1)
    await reconcileRedemptionCodes(tx, ALICE)
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
  })

  it('voids the newest codes when units leave, keeping the oldest', async () => {
    inv.set(`${ALICE}:${ITEM}`, 3)
    const { minted } = await reconcileRedemptionCodes(tx, ALICE)
    inv.set(`${ALICE}:${ITEM}`, 1)
    const r = await reconcileRedemptionCodes(tx, ALICE, { voidReason: 'sent' })
    expect(r.voided).toBe(2)
    expect(active(ALICE).map((c) => c.code)).toEqual([minted[0]])
    expect(codes.filter((c) => c.status === 'VOID').every((c) => c.voidReason === 'sent' && c.voidedAt)).toBe(true)
  })

  it('voids everything when the row is gone', async () => {
    inv.set(`${ALICE}:${ITEM}`, 2)
    await reconcileRedemptionCodes(tx, ALICE)
    inv.delete(`${ALICE}:${ITEM}`)
    expect((await reconcileRedemptionCodes(tx, ALICE)).voided).toBe(2)
    expect(active(ALICE)).toHaveLength(0)
  })

  it('is a no-op while the feature is off or for another item, without taking a lock', async () => {
    inv.set(`${ALICE}:${ITEM}`, 2)
    settings['proofOfPizza.itemId'] = 0
    expect(await reconcileRedemptionCodes(tx, ALICE)).toEqual({ minted: [], voided: 0 })
    settings['proofOfPizza.itemId'] = ITEM
    expect(await reconcileRedemptionCodes(tx, ALICE, { touchedItemId: 99 })).toEqual({ minted: [], voided: 0 })
    expect(tx.$executeRaw).not.toHaveBeenCalled()
    expect(codes).toHaveLength(0)
  })

  it('retries on a collision with an existing code (VOID codes are never reissued)', async () => {
    codes.push({ id: nextId++, code: 'AAAA', itemId: ITEM, discordId: BOB, status: 'VOID', acquiredAt: new Date(), redeemedAt: null, redeemedRef: null, voidedAt: new Date(), voidReason: 'sent', dmSentAt: null })
    inv.set(`${ALICE}:${ITEM}`, 1)
    const seq = ['AAAA', 'AAAA', 'BBBB']
    let i = 0
    const r = await reconcileRedemptionCodes(tx, ALICE, { generate: () => seq[Math.min(i++, seq.length - 1)] })
    expect(r.minted).toEqual(['BBBB'])
  })

  it('stamps minted codes with the given acquired time (backfill)', async () => {
    inv.set(`${ALICE}:${ITEM}`, 1)
    const at = new Date('2026-01-02T03:04:05Z')
    await reconcileRedemptionCodes(tx, ALICE, { acquiredAt: at })
    expect(codes[0].acquiredAt).toEqual(at)
  })
})

describe('redeemCode', () => {
  async function holder(units: number) {
    inv.set(`${ALICE}:${ITEM}`, units)
    return (await reconcileRedemptionCodes(tx, ALICE)).minted
  }

  it('redeems: code REDEEMED, one unit consumed, row deleted at zero', async () => {
    const [c] = await holder(1)
    const r = await redeemCode(c, 'proofofpizza:s1')
    expect(r.status).toBe('redeemed')
    expect(inv.has(`${ALICE}:${ITEM}`)).toBe(false)
    expect(codes[0]).toMatchObject({ status: 'REDEEMED', redeemedRef: 'proofofpizza:s1' })
  })

  it('keeps the invariant with several units', async () => {
    const minted = await holder(3)
    await redeemCode(minted[1], 'proofofpizza:s1')
    expect(inv.get(`${ALICE}:${ITEM}`)).toBe(2)
    expect(active(ALICE)).toHaveLength(2)
  })

  it('is idempotent on the same ref and consumes only one unit', async () => {
    const [c] = await holder(2)
    await redeemCode(c, 'proofofpizza:s1')
    const again = await redeemCode(c, 'proofofpizza:s1')
    expect(again.status).toBe('already')
    expect(inv.get(`${ALICE}:${ITEM}`)).toBe(1)
  })

  it('refuses a different ref on a used code (409)', async () => {
    const [c] = await holder(2)
    await redeemCode(c, 'proofofpizza:s1')
    expect((await redeemCode(c, 'proofofpizza:s2')).status).toBe('conflict')
    expect(inv.get(`${ALICE}:${ITEM}`)).toBe(1)
  })

  it('treats unknown and void codes as not found', async () => {
    expect((await redeemCode('ZZZZ', 'proofofpizza:s1')).status).toBe('not_found')
    const [c] = await holder(1)
    inv.delete(`${ALICE}:${ITEM}`)
    await reconcileRedemptionCodes(tx, ALICE, { voidReason: 'sent' })
    expect((await redeemCode(c, 'proofofpizza:s1')).status).toBe('not_found')
  })

  it('a unit that left without a reconcile is voided, not redeemed', async () => {
    const [c] = await holder(1)
    inv.delete(`${ALICE}:${ITEM}`) // a write path that skipped reconcile
    expect((await redeemCode(c, 'proofofpizza:s1')).status).toBe('not_found')
    expect(codes[0].status).toBe('VOID')
  })

  it('refuses everything while the feature is off', async () => {
    const [c] = await holder(1)
    settings['proofOfPizza.itemId'] = 0
    expect((await redeemCode(c, 'proofofpizza:s1')).status).toBe('not_found')
    expect(inv.get(`${ALICE}:${ITEM}`)).toBe(1)
  })

  it('rolls back the status change if the unit cannot be taken', async () => {
    const [c] = await holder(1)
    tx.inventory.updateMany.mockResolvedValueOnce({ count: 0 })
    // The fake has no real rollback, so assert the module reports not_found (the real tx aborts).
    expect((await redeemCode(c, 'proofofpizza:s1')).status).toBe('not_found')
  })
})

describe('lookupCode', () => {
  it('reports unknown, active (with holder and date), redeemed and void', async () => {
    expect(await lookupCode('ZZZZ')).toEqual({ status: 'unknown' })
    inv.set(`${ALICE}:${ITEM}`, 2)
    const { minted } = await reconcileRedemptionCodes(tx, ALICE)
    const a = await lookupCode(minted[0])
    expect(a).toMatchObject({ status: 'active', holderName: `Name ${ALICE}` })
    expect(typeof (a as { acquiredAt: string }).acquiredAt).toBe('string')
    await redeemCode(minted[0], 'proofofpizza:s1')
    expect(await lookupCode(minted[0])).toMatchObject({ status: 'redeemed', redeemedRef: 'proofofpizza:s1' })
    inv.delete(`${ALICE}:${ITEM}`)
    expect(await lookupCode(minted[1])).toEqual({ status: 'void' })
  })

  it('does not expose a holder for non-active codes', async () => {
    inv.set(`${ALICE}:${ITEM}`, 1)
    const { minted } = await reconcileRedemptionCodes(tx, ALICE)
    await redeemCode(minted[0], 'proofofpizza:s1')
    expect(JSON.stringify(await lookupCode(minted[0]))).not.toContain('Name')
  })
})

describe('getMyCodes', () => {
  it('heals first, then lists active and redeemed codes; empty when off', async () => {
    inv.set(`${ALICE}:${ITEM}`, 2)
    const r = await getMyCodes(ALICE)
    expect(r.enabled).toBe(true)
    expect(r.active).toHaveLength(2)
    await redeemCode(r.active[0].code, 'proofofpizza:s1')
    const after = await getMyCodes(ALICE)
    expect(after.active).toHaveLength(1)
    expect(after.redeemed).toHaveLength(1)
    settings['proofOfPizza.itemId'] = 0
    expect(await getMyCodes(ALICE)).toMatchObject({ enabled: false, active: [], redeemed: [] })
  })
})
