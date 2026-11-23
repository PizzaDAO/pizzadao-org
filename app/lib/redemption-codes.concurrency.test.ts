// @vitest-environment node
//
// Real-Postgres suite for Proof of Pizza codes (app/lib/redemption-codes.ts). Skipped unless
// PEP_IT_DATABASE_URL points at a LOCAL Postgres built with `prisma db push`;
// `npm run test:pep-concurrency` runs it with the other concurrency suites.
//
// Invariant under parallel buys, redeems and sends (including A->B racing B->A): no deadlock, and for
// every member count(ACTIVE codes) == Inventory.quantity.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

const DB_URL = process.env.PEP_IT_DATABASE_URL || ''
const isLocal = (() => {
  try {
    return ['localhost', '127.0.0.1'].includes(new URL(DB_URL).hostname)
  } catch {
    return false
  }
})()

let itemIdSetting = 0
vi.mock('./settings', () => ({ getSetting: async (k: string) => (k === 'proofOfPizza.itemId' ? itemIdSetting : 'https://proofof.pizza') }))
vi.mock('./notifications', () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./sheets/member-repository', () => ({ fetchMemberIdByDiscordId: vi.fn().mockResolvedValue(null) }))

/* eslint-disable @typescript-eslint/no-explicit-any */
let prisma: any
let codes: typeof import('./redemption-codes')
let shop: typeof import('./shop')

const RUN = String(Date.now()).slice(-9)
let seq = 0
const uid = () => `7${RUN}${String(++seq).padStart(8, '0')}`

async function seedUser(wallet = 0) {
  const id = uid()
  await prisma.user.create({ data: { id, roles: [] } })
  await prisma.economy.create({ data: { id, wallet } })
  return id
}

/** The same lock order and reconcile calls as POST /api/inventory/send. */
async function send(from: string, to: string, itemId: number, quantity: number) {
  await prisma.$transaction(async (tx: any) => {
    await codes.lockInventoryRows(tx, [from, to], itemId)
    const debit = await tx.inventory.updateMany({ where: { userId: from, itemId, quantity: { gte: quantity } }, data: { quantity: { decrement: quantity } } })
    if (debit.count !== 1) throw new Error('Insufficient items in inventory')
    await tx.inventory.deleteMany({ where: { userId: from, itemId, quantity: { lte: 0 } } })
    await tx.inventory.upsert({ where: { userId_itemId: { userId: to, itemId } }, create: { userId: to, itemId, quantity }, update: { quantity: { increment: quantity } } })
    for (const id of [from, to].sort()) await codes.reconcileRedemptionCodes(tx, id, { touchedItemId: itemId, voidReason: 'sent' })
  })
}

const held = async (u: string, itemId: number) => (await prisma.inventory.findUnique({ where: { userId_itemId: { userId: u, itemId } } }))?.quantity ?? 0
const activeCodes = (u: string, itemId: number) => prisma.redemptionCode.findMany({ where: { discordId: u, itemId, status: 'ACTIVE' } })

describe.skipIf(!isLocal)('redemption codes on real Postgres', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL
    const u = new URL(DB_URL)
    process.env.E2E_PG_HOST = '127.0.0.1'
    process.env.E2E_PG_PORT = u.port || '5432'
    createRequire(import.meta.url)(resolve(process.cwd(), 'e2e/local/preload.cjs'))
    prisma = (await import('./db')).prisma
    codes = await import('./redemption-codes')
    shop = await import('./shop')
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('parallel buys, redeems and A<->B sends: no deadlock, codes always equal units', async () => {
    const item = await prisma.shopItem.create({ data: { name: `pop-${RUN}`, price: 1, quantity: -1, isAvailable: true } })
    itemIdSetting = item.id
    const a = await seedUser(1000)
    const b = await seedUser(1000)
    for (const u of [a, b]) for (let i = 0; i < 4; i++) await shop.buyItem(u, item.id, 1)

    const toRedeem = [...(await activeCodes(a, item.id)).slice(0, 2), ...(await activeCodes(b, item.id)).slice(0, 2)]
    const ops: Promise<unknown>[] = [
      ...toRedeem.map((c: any, i: number) => codes.redeemCode(c.code, `proofofpizza:s${RUN}${i}`)),
      shop.buyItem(a, item.id, 1),
      shop.buyItem(b, item.id, 1),
      send(a, b, item.id, 1),
      send(b, a, item.id, 1),
      send(a, b, item.id, 1),
      send(b, a, item.id, 1),
    ]
    const results = await Promise.allSettled(ops)
    // A send can lose to a redeem for the last unit; nothing may fail with a deadlock.
    for (const r of results) if (r.status === 'rejected') expect(String((r as PromiseRejectedResult).reason)).not.toMatch(/deadlock|40P01/i)

    for (const u of [a, b]) expect((await activeCodes(u, item.id)).length).toBe(await held(u, item.id))
  }, 60_000)
})
