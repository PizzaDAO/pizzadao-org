// @vitest-environment node
//
// Real-Postgres suite for /admin/shop (app/lib/shop-admin.ts). Skipped unless
// PEP_IT_DATABASE_URL points at a LOCAL Postgres built with `prisma db push`;
// `npm run test:pep-concurrency` starts a throwaway docker Postgres and runs
// this file after pep-economy.concurrency.test.ts.
//
// Covers: audit rows for every change (CREATE / UPDATE / HIDE / SHOW /
// DELETE / RESTOCK / ADJUST_STOCK / GRANT / REMOVE), hide vs hard delete,
// stale-stock edits, stock adjustments racing each other and purchases,
// grants (idempotent by requestId, PENDING for members without an account,
// credited exactly once on login) and removals racing each other and
// purchases (inventory never negative).
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

vi.mock('./notifications', () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./discord', () => ({
  getMembersWithRoles: vi.fn().mockResolvedValue([]),
  hasAnyRole: vi.fn().mockResolvedValue(false),
  getUserRoles: vi.fn().mockResolvedValue([]),
  sendDM: vi.fn().mockResolvedValue({ success: false }),
}))
vi.mock('./sheets/member-repository', () => ({ fetchMemberIdByDiscordId: vi.fn().mockResolvedValue(null) }))

/* eslint-disable @typescript-eslint/no-explicit-any */
let prisma: any
let admin: typeof import('./shop-admin')
let shop: typeof import('./shop')
let grants: typeof import('./shop-grants')

const N = 20
const RUN = String(Date.now()).slice(-9)
let seq = 0
const uid = () => `8${RUN}${String(++seq).padStart(8, '0')}` // 18-digit fake snowflake
const ACTOR = '700000000000000001'
let itemSeq = 0
const itemName = (label: string) => `sa-${RUN}-${++itemSeq}-${label}`

async function seedUser(wallet = 0) {
  const id = uid()
  await prisma.user.create({ data: { id, roles: [] } })
  await prisma.economy.create({ data: { id, wallet } })
  return id
}

const newItem = (label: string, extra: Record<string, unknown> = {}) =>
  admin.createShopItem(ACTOR, { name: itemName(label), price: 10, quantity: -1, isAvailable: true, isCollectible: false, ...extra })

const events = (itemId: number) => prisma.shopAdminEvent.findMany({ where: { itemId }, orderBy: { id: 'asc' } })
const held = async (userId: string, itemId: number) =>
  (await prisma.inventory.findUnique({ where: { userId_itemId: { userId, itemId } } }))?.quantity ?? 0
const stock = async (id: number) => (await prisma.shopItem.findUniqueOrThrow({ where: { id } })).quantity as number

function outcomes(results: PromiseSettledResult<unknown>[]) {
  return {
    ok: results.filter((r) => r.status === 'fulfilled').length,
    failed: results.filter((r) => r.status === 'rejected').length,
  }
}

describe.skipIf(!isLocal)('shop admin on real Postgres', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL
    const u = new URL(DB_URL)
    process.env.E2E_PG_HOST = '127.0.0.1'
    process.env.E2E_PG_PORT = u.port || '5432'
    createRequire(import.meta.url)(resolve(process.cwd(), 'e2e/local/preload.cjs'))
    prisma = (await import('./db')).prisma
    admin = await import('./shop-admin')
    shop = await import('./shop')
    grants = await import('./shop-grants')
  }, 60_000)

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  // ------------------------------------------------------- create / edit ---

  it('create writes a CREATE audit row; a near-duplicate name is refused', async () => {
    const item = await newItem('Party Hat')
    const ev = await events(item.id)
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ actorId: ACTOR, action: 'CREATE', itemName: item.name })
    expect(ev[0].after).toMatchObject({ name: item.name, price: 10, quantity: -1, isAvailable: true })
    await expect(
      admin.createShopItem(ACTOR, { name: item.name.toUpperCase().replace(/-/g, ' '), price: 5 }),
    ).rejects.toThrow(/already exists/)
  })

  it('a collectible is created off sale and cannot be shown or bought', async () => {
    const pin = await newItem('Pin', { isCollectible: true, isAvailable: true })
    expect(pin).toMatchObject({ isCollectible: true, isAvailable: false })
    await expect(admin.setShopItemVisibility(ACTOR, pin.id, true)).rejects.toThrow(/never for sale/)
    const buyer = await seedUser(100)
    await expect(shop.buyItem(buyer, pin.id, 1)).rejects.toThrow()
    expect((await shop.getShopItems()).some((i: any) => i.id === pin.id)).toBe(false)
  })

  it('edit (rename + price) logs only the changed fields; price applies to the next purchase only', async () => {
    const item = await newItem('Old Name', { price: 10 })
    const buyer = await seedUser(100)
    await shop.buyItem(buyer, item.id, 1)
    const renamed = itemName('New Name')
    await admin.updateShopItem(ACTOR, item.id, {
      name: renamed,
      description: '',
      price: 25,
      quantity: -1,
      image: '',
      isAvailable: true,
      isCollectible: false,
      expectedQuantity: -1,
      reason: 'rebrand',
    })
    const ev = (await events(item.id)).at(-1)
    expect(ev).toMatchObject({ action: 'UPDATE', itemName: renamed, reason: 'rebrand' })
    expect(ev.before).toEqual({ name: item.name, price: 10 })
    expect(ev.after).toEqual({ name: renamed, price: 25 })
    // The earlier purchase keeps its price in the ledger; the next one pays 25.
    await shop.buyItem(buyer, item.id, 1)
    const paid = (await prisma.transaction.findMany({ where: { userId: buyer, type: 'SHOP_PURCHASE' }, orderBy: { id: 'asc' } })).map(
      (t: any) => t.amount,
    )
    expect(paid).toEqual([-10, -25])
    // Holdings follow the item id, not the name.
    expect(await held(buyer, item.id)).toBe(2)
  })

  it('an edit that leaves stock alone keeps what purchases sold; a stale stock edit is a 409', async () => {
    const item = await newItem('Limited', { quantity: 5 })
    const buyer = await seedUser(100)
    await shop.buyItem(buyer, item.id, 2) // stock 5 -> 3 while the admin has the form open (saw 5)
    const form = { name: item.name, description: 'new copy', price: 10, quantity: 5, image: '', isAvailable: true, isCollectible: false, expectedQuantity: 5 }
    await admin.updateShopItem(ACTOR, item.id, form)
    expect(await stock(item.id)).toBe(3) // untouched stock field: purchases kept
    await expect(admin.updateShopItem(ACTOR, item.id, { ...form, quantity: 10 })).rejects.toThrow(/Stock changed/)
    expect(await stock(item.id)).toBe(3)
    await admin.updateShopItem(ACTOR, item.id, { ...form, quantity: 10, expectedQuantity: 3 })
    expect(await stock(item.id)).toBe(10)
  })

  // ------------------------------------------------------ hide vs delete ---

  it('an item never bought, held or granted can be hard-deleted; its DELETE audit row survives', async () => {
    const item = await newItem('Typo Item')
    expect((await admin.getShopAdminOverview()).items.find((i) => i.id === item.id)?.canDelete).toBe(true)
    await admin.deleteShopItem(ACTOR, item.id)
    expect(await prisma.shopItem.findUnique({ where: { id: item.id } })).toBeNull()
    const ev = await events(item.id)
    expect(ev.map((e: any) => e.action)).toEqual(['CREATE', 'DELETE'])
    expect(ev[1].before).toMatchObject({ name: item.name })
  })

  it('an item with history can only be hidden: bought, held-only (granted), or ledger-only', async () => {
    const bought = await newItem('Bought')
    const buyer = await seedUser(100)
    await shop.buyItem(buyer, bought.id, 1)

    const granted = await newItem('Granted')
    const ghost = uid() // no account: PENDING grant, no Inventory row
    await admin.adminGrantItem(ACTOR, { discordId: ghost, itemId: granted.id, quantity: 1, reason: 'prize' })

    const ledgerOnly = await newItem('LedgerOnly')
    await shop.buyItem(buyer, ledgerOnly.id, 1)
    await admin.adminRemoveItem(ACTOR, { discordId: buyer, itemId: ledgerOnly.id, quantity: 1, reason: 'refund test' })
    expect(await held(buyer, ledgerOnly.id)).toBe(0)

    const overview = await admin.getShopAdminOverview()
    for (const it of [bought, granted, ledgerOnly]) {
      expect(overview.items.find((i) => i.id === it.id)?.canDelete, it.name).toBe(false)
      await expect(admin.deleteShopItem(ACTOR, it.id), it.name).rejects.toThrow(/only be hidden/)
      expect(await prisma.shopItem.findUnique({ where: { id: it.id } })).not.toBeNull()
    }

    await admin.setShopItemVisibility(ACTOR, bought.id, false, 'out of season')
    const ev = (await events(bought.id)).at(-1)
    expect(ev).toMatchObject({ action: 'HIDE', reason: 'out of season', before: { isAvailable: true }, after: { isAvailable: false } })
    await expect(shop.buyItem(buyer, bought.id, 1)).rejects.toThrow(/not available/)
    expect(await held(buyer, bought.id)).toBe(1) // holdings untouched
    await admin.setShopItemVisibility(ACTOR, bought.id, true)
    expect((await events(bought.id)).at(-1).action).toBe('SHOW')
  })

  it('overview counts units sold (SHOP_PURCHASE) and held (Inventory) plus pending grants', async () => {
    const item = await newItem('Counted')
    const a = await seedUser(100)
    const b = await seedUser(100)
    await shop.buyItem(a, item.id, 3)
    await shop.buyItem(b, item.id, 2)
    await admin.adminGrantItem(ACTOR, { discordId: a, itemId: item.id, quantity: 4, reason: 'bonus' })
    await admin.adminGrantItem(ACTOR, { discordId: uid(), itemId: item.id, quantity: 6, reason: 'bonus' })
    await admin.adminRemoveItem(ACTOR, { discordId: b, itemId: item.id, quantity: 1, reason: 'oops' })
    const row = (await admin.getShopAdminOverview()).items.find((i) => i.id === item.id)
    expect(row).toMatchObject({ sold: 5, held: 3 + 4 + 1, pending: 6, canDelete: false })
  })

  // --------------------------------------------------------------- stock ---

  it(`${N} parallel -1 adjustments on stock 5: exactly 5 land, stock 0, 5 audit rows`, async () => {
    const item = await newItem('Adjust', { quantity: 5 })
    const res = await Promise.allSettled(Array.from({ length: N }, () => admin.adjustShopItemStock(ACTOR, item.id, -1, 'shrinkage')))
    expect(outcomes(res)).toEqual({ ok: 5, failed: N - 5 })
    expect(await stock(item.id)).toBe(0)
    const adj = (await events(item.id)).filter((e: any) => e.action === 'ADJUST_STOCK')
    expect(adj).toHaveLength(5)
    expect(adj.every((e: any) => e.quantity === 1 && e.reason === 'shrinkage')).toBe(true)
    // Each audit row's before -> after chains.
    expect(adj.map((e: any) => [e.before.quantity, e.after.quantity])).toEqual([[5, 4], [4, 3], [3, 2], [2, 1], [1, 0]])
  })

  it('restock adds with a RESTOCK row; unlimited stock and a missing reason are refused', async () => {
    const item = await newItem('Restock', { quantity: 0 })
    await admin.adjustShopItemStock(ACTOR, item.id, 12, 'new batch')
    expect(await stock(item.id)).toBe(12)
    expect((await events(item.id)).at(-1)).toMatchObject({ action: 'RESTOCK', quantity: 12, before: { quantity: 0 }, after: { quantity: 12 } })
    await expect(admin.adjustShopItemStock(ACTOR, item.id, 1, '')).rejects.toThrow(/Reason/)
    const unlimited = await newItem('Unlimited')
    await expect(admin.adjustShopItemStock(ACTOR, unlimited.id, 1, 'more')).rejects.toThrow(/unlimited/)
  })

  it(`stock adjustments racing ${N} purchases never oversell or go negative`, async () => {
    const item = await newItem('Race', { quantity: 10 })
    const buyers = await Promise.all(Array.from({ length: N }, () => seedUser(100)))
    const res = await Promise.allSettled([
      ...buyers.map((b) => shop.buyItem(b, item.id, 1)),
      ...Array.from({ length: N }, () => admin.adjustShopItemStock(ACTOR, item.id, -1, 'damaged')),
    ])
    expect(outcomes(res).ok).toBe(10)
    expect(await stock(item.id)).toBe(0)
    const bought = (await Promise.all(buyers.map((b) => held(b, item.id)))).reduce((s, n) => s + n, 0)
    const adjusted = (await events(item.id)).filter((e: any) => e.action === 'ADJUST_STOCK').length
    expect(bought + adjusted).toBe(10)
  })

  // ------------------------------------------------------ grant / remove ---

  it(`${N} parallel grants with one requestId land once (double submit); distinct ids each land`, async () => {
    const item = await newItem('Grant')
    const member = await seedUser()
    const requestId = `req-${RUN}-once`
    const res = await Promise.all(
      Array.from({ length: N }, () => admin.adminGrantItem(ACTOR, { discordId: member, itemId: item.id, quantity: 2, reason: 'prize', requestId })),
    )
    expect(res.filter((r) => r.status === 'credited')).toHaveLength(1)
    expect(res.filter((r) => r.status === 'duplicate')).toHaveLength(N - 1)
    expect(await held(member, item.id)).toBe(2)
    const many = await Promise.all(
      Array.from({ length: N }, () => admin.adminGrantItem(ACTOR, { discordId: member, itemId: item.id, quantity: 1, reason: 'prize' })),
    )
    expect(many.every((r) => r.status === 'credited')).toBe(true)
    expect(await held(member, item.id)).toBe(2 + N)
    const g = (await events(item.id)).filter((e: any) => e.action === 'GRANT')
    expect(g).toHaveLength(1 + N)
    expect(g[0]).toMatchObject({ targetId: member, quantity: 2, reason: 'prize', after: { status: 'CREDITED' } })
    const rows = await prisma.itemGrant.findMany({ where: { itemId: item.id } })
    expect(rows.every((r: any) => r.source === 'admin' && r.grantKey.startsWith('admin:'))).toBe(true)
  })

  it('a grant to a member with no account is held PENDING, then credited once across parallel logins', async () => {
    const item = await newItem('Pending', { isCollectible: true })
    const ghost = uid()
    const r = await admin.adminGrantItem(ACTOR, { discordId: ghost, itemId: item.id, quantity: 3, reason: 'carry over' })
    expect(r.status).toBe('held')
    expect(await held(ghost, item.id)).toBe(0)
    expect((await events(item.id)).at(-1)).toMatchObject({ action: 'GRANT', targetId: ghost, after: { status: 'PENDING' } })
    await prisma.user.create({ data: { id: ghost, roles: [] } })
    await Promise.all(Array.from({ length: N }, () => grants.creditPendingItemGrants(ghost)))
    expect(await held(ghost, item.id)).toBe(3)
  })

  it(`${N} parallel removals of 1 from a holder of 5: exactly 5 land, never negative, row deleted at 0`, async () => {
    const item = await newItem('Remove')
    const member = await seedUser()
    await admin.adminGrantItem(ACTOR, { discordId: member, itemId: item.id, quantity: 5, reason: 'seed' })
    const res = await Promise.allSettled(
      Array.from({ length: N }, () => admin.adminRemoveItem(ACTOR, { discordId: member, itemId: item.id, quantity: 1, reason: 'cleanup' })),
    )
    expect(outcomes(res)).toEqual({ ok: 5, failed: N - 5 })
    expect(await prisma.inventory.findUnique({ where: { userId_itemId: { userId: member, itemId: item.id } } })).toBeNull()
    const rm = (await events(item.id)).filter((e: any) => e.action === 'REMOVE')
    expect(rm).toHaveLength(5)
    expect(rm.every((e: any) => e.targetId === member && e.quantity === 1 && e.reason === 'cleanup')).toBe(true)
    expect(rm.map((e: any) => e.after.held).sort()).toEqual([0, 1, 2, 3, 4])
    await expect(admin.adminRemoveItem(ACTOR, { discordId: member, itemId: item.id, quantity: 1, reason: 'again' })).rejects.toThrow(/only hold 0/)
  })

  it(`removals racing purchases and grants keep inventory = bought + granted - removed, never < 0`, async () => {
    const item = await newItem('Mixed')
    const member = await seedUser(1_000)
    await shop.buyItem(member, item.id, 3)
    const res = await Promise.allSettled([
      ...Array.from({ length: N }, () => admin.adminRemoveItem(ACTOR, { discordId: member, itemId: item.id, quantity: 2, reason: 'race' })),
      ...Array.from({ length: 5 }, () => shop.buyItem(member, item.id, 1)),
      ...Array.from({ length: 5 }, () => admin.adminGrantItem(ACTOR, { discordId: member, itemId: item.id, quantity: 1, reason: 'race' })),
    ])
    expect(outcomes(res).ok).toBeGreaterThan(0)
    const removed = (await events(item.id)).filter((e: any) => e.action === 'REMOVE').reduce((s: number, e: any) => s + e.quantity, 0)
    const now = await held(member, item.id)
    expect(now).toBeGreaterThanOrEqual(0)
    expect(now).toBe(3 + 5 + 5 - removed)
    const negatives = await prisma.inventory.count({ where: { quantity: { lt: 0 } } })
    expect(negatives).toBe(0)
  })

  it('grant / remove validate input before touching anything', async () => {
    const item = await newItem('Validate')
    const member = await seedUser()
    await expect(admin.adminGrantItem(ACTOR, { discordId: member, itemId: item.id, quantity: 0, reason: 'x y z' })).rejects.toThrow(/Quantity/)
    await expect(admin.adminGrantItem(ACTOR, { discordId: member, itemId: item.id, quantity: 1, reason: '' })).rejects.toThrow(/Reason/)
    await expect(admin.adminGrantItem(ACTOR, { discordId: 'nope', itemId: item.id, quantity: 1, reason: 'abc' })).rejects.toThrow(/Invalid member/)
    await expect(admin.adminGrantItem(ACTOR, { discordId: member, itemId: 2_000_000_000, quantity: 1, reason: 'abc' })).rejects.toThrow(/not found/)
    await expect(admin.adminRemoveItem(ACTOR, { discordId: member, itemId: item.id, quantity: 10_001, reason: 'abc' })).rejects.toThrow(/Quantity/)
    expect((await events(item.id)).map((e: any) => e.action)).toEqual(['CREATE'])
  })
})
