/**
 * Shop admin (/admin/shop): create, edit, hide, restock and (rarely) delete
 * $PEP shop items, and grant / remove items to / from members. Replaces the
 * Google-Sheet sync (POST /api/shop/sync, now off unless
 * SHOP_SHEET_SYNC_ENABLED=1) as the way the shop is managed.
 *
 * Every change commits in ONE transaction together with its ShopAdminEvent
 * audit row, so the log can't miss a change or record one that rolled back.
 *
 * Concurrency:
 *   * Item edits, visibility, stock adjustments and deletes lock the ShopItem
 *     row (SELECT ... FOR UPDATE) first, so they serialize with each other and
 *     with buyItem's conditional stock decrement.
 *   * An edit only writes the stock when the admin changed it, and only if
 *     the stock is still what they saw (expectedQuantity); otherwise it's a
 *     409 and they reload (a purchase may have sold units meanwhile).
 *   * Restock / adjust are relative (+n / -n) and can't take stock below 0.
 *   * Removing an item from a member is a conditional decrement
 *     (quantity >= n), so however many removals race, inventory never goes
 *     negative.
 *   * Grants are keyed by ItemGrant.grantKey "admin:<requestId>": a retried or
 *     double-submitted grant (same requestId) lands once.
 *
 * Callers must already have checked the actor may manage the shop
 * (requireShopAdmin in shop-admin-auth.ts). Price changes only affect future
 * purchases (buyItem reads the price at purchase time; the ledger keeps what
 * was paid). Grants don't touch shop stock or any wallet.
 */
import { Prisma, type ShopAdminAction, type ShopItem } from '@prisma/client'
import { randomUUID } from 'crypto'
import { prisma } from './db'
import { ConflictError, NotFoundError, ValidationError } from './errors/api-errors'
import { normalizeReason } from './pep-admin'
import { normalizeItemName } from './shop-grants'
import { SHOP_LIMITS } from './shop-admin-shared'

export { SHOP_LIMITS }

/** Grants made here are ItemGrant rows with this source. */
export const ADMIN_GRANT_SOURCE = 'admin'

// --------------------------------------------------------- validation ---

export interface ShopItemInput {
  name: string
  description: string | null
  price: number
  /** -1 = unlimited */
  quantity: number
  image: string | null
  isAvailable: boolean
  isCollectible: boolean
}

const CONTROL = /[\u0000-\u001f\u007f]/

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

function str(raw: unknown, field: string): string {
  if (raw === undefined || raw === null) return ''
  if (typeof raw !== 'string') throw new ValidationError(`${field} must be text`, field)
  return raw
}

function int(raw: unknown, field: string, label: string): number {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw.trim()) : raw
  if (typeof n !== 'number' || !Number.isInteger(n)) {
    throw new ValidationError(`${label} must be a whole number`, field)
  }
  return n
}

function bool(raw: unknown, field: string): boolean {
  if (typeof raw !== 'boolean') throw new ValidationError(`${field} must be true or false`, field)
  return raw
}

/** Item name: one line, 1-60 chars, no control characters. */
export function validateItemName(raw: unknown): string {
  const name = oneLine(str(raw, 'name'))
  if (!name) throw new ValidationError('Name is required', 'name')
  if (name.length > SHOP_LIMITS.nameMax) {
    throw new ValidationError(`Name can be at most ${SHOP_LIMITS.nameMax} characters`, 'name')
  }
  if (CONTROL.test(name)) throw new ValidationError('Name contains invalid characters', 'name')
  return name
}

/**
 * Image URL: empty (no image), an https URL without credentials, or a
 * site-relative path ("/shop/pin.png"). At most 500 characters.
 */
export function validateImageUrl(raw: unknown): string | null {
  const s = str(raw, 'image').trim()
  if (!s) return null
  if (s.length > SHOP_LIMITS.imageUrlMax) {
    throw new ValidationError(`Image URL can be at most ${SHOP_LIMITS.imageUrlMax} characters`, 'image')
  }
  if (CONTROL.test(s) || /\s/.test(s)) throw new ValidationError('Image URL contains invalid characters', 'image')
  if (s.startsWith('/') && !s.startsWith('//')) return s
  let u: URL
  try {
    u = new URL(s)
  } catch {
    throw new ValidationError('Image must be a valid https URL', 'image')
  }
  if (u.protocol !== 'https:') throw new ValidationError('Image URL must start with https://', 'image')
  if (u.username || u.password) throw new ValidationError('Image URL must not contain credentials', 'image')
  return u.toString()
}

/** Validate a full create / edit form. A collectible is never purchasable. */
export function parseItemInput(raw: unknown): ShopItemInput {
  if (!raw || typeof raw !== 'object') throw new ValidationError('Invalid item')
  const r = raw as Record<string, unknown>
  const name = validateItemName(r.name)

  const description = str(r.description, 'description').trim()
  if (description.length > SHOP_LIMITS.descriptionMax) {
    throw new ValidationError(`Description can be at most ${SHOP_LIMITS.descriptionMax} characters`, 'description')
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(description)) {
    throw new ValidationError('Description contains invalid characters', 'description')
  }

  const price = int(r.price, 'price', 'Price')
  if (price <= 0) throw new ValidationError('Price must be a positive whole number', 'price')
  if (price > SHOP_LIMITS.priceMax) {
    throw new ValidationError(`Price can be at most ${SHOP_LIMITS.priceMax.toLocaleString('en-US')}`, 'price')
  }

  const quantity = int(r.quantity ?? -1, 'quantity', 'Stock')
  if (quantity < -1) throw new ValidationError('Stock must be unlimited or a number 0 or more', 'quantity')
  if (quantity > SHOP_LIMITS.stockMax) {
    throw new ValidationError(`Stock can be at most ${SHOP_LIMITS.stockMax.toLocaleString('en-US')}`, 'quantity')
  }

  const isCollectible = r.isCollectible === undefined ? false : bool(r.isCollectible, 'isCollectible')
  const isAvailable = r.isAvailable === undefined ? true : bool(r.isAvailable, 'isAvailable')

  return {
    name,
    description: description || null,
    price,
    quantity,
    image: validateImageUrl(r.image),
    // Collectibles can be held, never bought: always off sale.
    isAvailable: isCollectible ? false : isAvailable,
    isCollectible,
  }
}

/** Required admin reason: one line, 3-200 chars. */
export function validateReason(raw: unknown): string {
  const reason = normalizeReason(raw)
  if (reason.length < SHOP_LIMITS.reasonMin || reason.length > SHOP_LIMITS.reasonMax) {
    throw new ValidationError(`Reason must be ${SHOP_LIMITS.reasonMin}-${SHOP_LIMITS.reasonMax} characters`, 'reason')
  }
  return reason
}

/** Units to grant / remove: 1..10,000. */
export function validateQty(raw: unknown, field = 'quantity'): number {
  const n = int(raw, field, 'Quantity')
  if (n <= 0) throw new ValidationError('Quantity must be a positive whole number', field)
  if (n > SHOP_LIMITS.qtyMax) {
    throw new ValidationError(`Quantity can be at most ${SHOP_LIMITS.qtyMax.toLocaleString('en-US')}`, field)
  }
  return n
}

/** Stock adjustment: a non-zero whole number, |delta| <= 10,000. */
export function validateStockDelta(raw: unknown): number {
  const n = int(raw, 'delta', 'Adjustment')
  if (n === 0) throw new ValidationError('Adjustment must not be 0', 'delta')
  if (Math.abs(n) > SHOP_LIMITS.qtyMax) {
    throw new ValidationError(`Adjustment can be at most ${SHOP_LIMITS.qtyMax.toLocaleString('en-US')} units`, 'delta')
  }
  return n
}

export function validateItemId(raw: unknown): number {
  const n = typeof raw === 'string' && /^\d{1,9}$/.test(raw) ? Number(raw) : raw
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0 || n > 2_147_483_647) {
    throw new ValidationError('Invalid item', 'itemId')
  }
  return n
}

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/
const DISCORD_ID = /^\d{17,20}$/
const ACTOR_ID = /^\d{5,25}$/

/** Idempotency key for a grant: 8-64 of [A-Za-z0-9_-]; a fresh one if absent. */
export function validateRequestId(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return randomUUID()
  if (typeof raw !== 'string' || !REQUEST_ID.test(raw)) throw new ValidationError('Invalid request id', 'requestId')
  return raw
}

function checkActor(actorId: string) {
  if (!ACTOR_ID.test(actorId)) throw new ValidationError('Invalid admin')
}

// ---------------------------------------------------------- internals ---

type Tx = Prisma.TransactionClient

const FIELDS = ['name', 'description', 'price', 'quantity', 'image', 'isAvailable', 'isCollectible'] as const
type Field = (typeof FIELDS)[number]

export function snapshot(item: Pick<ShopItem, Field>): Record<Field, unknown> {
  return {
    name: item.name,
    description: item.description,
    price: item.price,
    quantity: item.quantity,
    image: item.image,
    isAvailable: item.isAvailable,
    isCollectible: item.isCollectible,
  }
}

interface AuditEntry {
  actorId: string
  action: ShopAdminAction
  item: { id: number | null; name: string }
  targetId?: string | null
  quantity?: number | null
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  reason?: string | null
}

const json = (v: Record<string, unknown> | null | undefined) =>
  v ? (v as Prisma.InputJsonValue) : undefined

async function audit(tx: Tx, e: AuditEntry) {
  return tx.shopAdminEvent.create({
    data: {
      actorId: e.actorId,
      action: e.action,
      itemId: e.item.id,
      itemName: e.item.name,
      targetId: e.targetId ?? null,
      quantity: e.quantity ?? null,
      before: json(e.before),
      after: json(e.after),
      reason: e.reason ?? null,
    },
  })
}

/** Lock the item row for the rest of the transaction and read it. */
async function lockItem(tx: Tx, id: number): Promise<ShopItem> {
  await tx.$queryRaw`SELECT id FROM "ShopItem" WHERE id = ${id} FOR UPDATE`
  const item = await tx.shopItem.findUnique({ where: { id } })
  if (!item) throw new NotFoundError('Item')
  return item
}

/** Refuse a name that matches another item ignoring case / punctuation ("Pizza Box" vs "pizza-box"). */
async function assertNameFree(tx: Tx | typeof prisma, name: string, exceptId?: number) {
  const key = normalizeItemName(name)
  const all = await tx.shopItem.findMany({ select: { id: true, name: true } })
  const clash = all.find((i) => i.id !== exceptId && normalizeItemName(i.name) === key)
  if (clash) throw new ConflictError(`An item named "${clash.name}" already exists`)
}

function isPrismaCode(e: unknown, code: string): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === code
}

// -------------------------------------------------------------- items ---

export async function createShopItem(actorId: string, raw: unknown): Promise<ShopItem> {
  checkActor(actorId)
  const input = parseItemInput(raw)
  try {
    return await prisma.$transaction(async (tx) => {
      await assertNameFree(tx, input.name)
      const item = await tx.shopItem.create({ data: input })
      await audit(tx, { actorId, action: 'CREATE', item, after: snapshot(item) })
      return item
    })
  } catch (e) {
    if (isPrismaCode(e, 'P2002')) throw new ConflictError(`An item named "${input.name}" already exists`)
    throw e
  }
}

/**
 * Edit an item (full form). `expectedQuantity` is the stock the admin saw when
 * they opened the form: the stock is only written if they changed it, and only
 * if it hasn't moved since (else 409). Only changed fields are written and
 * logged; a change of nothing but availability is logged as HIDE / SHOW.
 */
export async function updateShopItem(actorId: string, id: number, raw: unknown): Promise<ShopItem> {
  checkActor(actorId)
  const input = parseItemInput(raw)
  const r = (raw ?? {}) as Record<string, unknown>
  const expectedQuantity =
    r.expectedQuantity === undefined || r.expectedQuantity === null
      ? undefined
      : int(r.expectedQuantity, 'expectedQuantity', 'Expected stock')
  const reasonRaw = normalizeReason(r.reason)
  const reason = reasonRaw ? validateReason(reasonRaw) : null

  try {
    return await prisma.$transaction(async (tx) => {
      const before = await lockItem(tx, id)
      const data: Partial<ShopItemInput> = {}
      for (const f of FIELDS) {
        if (f === 'quantity') continue
        if (input[f] !== before[f]) (data as Record<string, unknown>)[f] = input[f]
      }
      // Stock: untouched in the form -> leave whatever purchases made of it.
      const stockEdited = expectedQuantity === undefined || input.quantity !== expectedQuantity
      if (stockEdited && input.quantity !== before.quantity) {
        if (expectedQuantity !== undefined && before.quantity !== expectedQuantity) {
          throw new ConflictError(
            `Stock changed since you opened this item (now ${before.quantity === -1 ? 'unlimited' : before.quantity}). Reload and try again.`,
          )
        }
        data.quantity = input.quantity
      }
      const keys = Object.keys(data) as Field[]
      if (keys.length === 0) return before
      if (data.name !== undefined) await assertNameFree(tx, data.name, id)

      const item = await tx.shopItem.update({ where: { id }, data })
      const action: ShopAdminAction =
        keys.length === 1 && keys[0] === 'isAvailable' ? (item.isAvailable ? 'SHOW' : 'HIDE') : 'UPDATE'
      await audit(tx, {
        actorId,
        action,
        item,
        before: Object.fromEntries(keys.map((k) => [k, before[k]])),
        after: Object.fromEntries(keys.map((k) => [k, item[k]])),
        reason,
      })
      return item
    })
  } catch (e) {
    if (isPrismaCode(e, 'P2002')) throw new ConflictError(`An item named "${input.name}" already exists`)
    throw e
  }
}

/** Take an item off sale (or put it back). Holdings and history are untouched. */
export async function setShopItemVisibility(
  actorId: string,
  id: number,
  visible: boolean,
  rawReason?: unknown,
): Promise<ShopItem> {
  checkActor(actorId)
  if (typeof visible !== 'boolean') throw new ValidationError('visible must be true or false', 'visible')
  const r = normalizeReason(rawReason)
  const reason = r ? validateReason(r) : null
  return prisma.$transaction(async (tx) => {
    const before = await lockItem(tx, id)
    if (visible && before.isCollectible) {
      throw new ValidationError('Collectibles are never for sale, so they cannot be shown in the shop')
    }
    if (before.isAvailable === visible) return before
    const item = await tx.shopItem.update({ where: { id }, data: { isAvailable: visible } })
    await audit(tx, {
      actorId,
      action: visible ? 'SHOW' : 'HIDE',
      item,
      before: { isAvailable: before.isAvailable },
      after: { isAvailable: item.isAvailable },
      reason,
    })
    return item
  })
}

/**
 * Restock (+n) or adjust down (-n) a limited-stock item, with a reason.
 * Unlimited items have no count to adjust (set a number in the edit form).
 */
export async function adjustShopItemStock(
  actorId: string,
  id: number,
  rawDelta: unknown,
  rawReason: unknown,
): Promise<ShopItem> {
  checkActor(actorId)
  const delta = validateStockDelta(rawDelta)
  const reason = validateReason(rawReason)
  return prisma.$transaction(async (tx) => {
    const before = await lockItem(tx, id)
    if (before.quantity === -1) {
      throw new ValidationError('This item has unlimited stock. Set a number in Edit first.', 'delta')
    }
    const next = before.quantity + delta
    if (next < 0) throw new ValidationError(`Only ${before.quantity} in stock, so at most ${before.quantity} can be removed`, 'delta')
    if (next > SHOP_LIMITS.stockMax) {
      throw new ValidationError(`Stock can be at most ${SHOP_LIMITS.stockMax.toLocaleString('en-US')}`, 'delta')
    }
    const item = await tx.shopItem.update({ where: { id }, data: { quantity: next } })
    await audit(tx, {
      actorId,
      action: delta > 0 ? 'RESTOCK' : 'ADJUST_STOCK',
      item,
      quantity: Math.abs(delta),
      before: { quantity: before.quantity },
      after: { quantity: item.quantity },
      reason,
    })
    return item
  })
}

export interface ItemHistory {
  /** Members holding it (Inventory rows). */
  holders: number
  /** ItemGrant rows (any source, pending or credited). */
  grants: number
  /** Ledger (Transaction) rows whose metadata names this item. */
  ledgerRows: number
}

async function itemHistory(tx: Tx | typeof prisma, id: number): Promise<ItemHistory> {
  const [holders, grants, ledger] = await Promise.all([
    tx.inventory.count({ where: { itemId: id } }),
    tx.itemGrant.count({ where: { itemId: id } }),
    tx.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n FROM "Transaction"
      WHERE metadata->>'itemId' = ${String(id)}`,
  ])
  return { holders, grants, ledgerRows: Number(ledger[0]?.n ?? 0) }
}

export const hasHistory = (h: ItemHistory) => h.holders > 0 || h.grants > 0 || h.ledgerRows > 0

/**
 * Hard delete. Only for an item nobody ever bought, held or was granted (a
 * mistake, a test item). Anything with history must be hidden instead, so
 * inventories, the ledger and grants keep pointing at a real item.
 */
export async function deleteShopItem(actorId: string, id: number): Promise<{ deleted: true; name: string }> {
  checkActor(actorId)
  try {
    return await prisma.$transaction(async (tx) => {
      const before = await lockItem(tx, id)
      if (hasHistory(await itemHistory(tx, id))) {
        throw new ConflictError('This item has been bought, held or granted, so it can only be hidden, not deleted')
      }
      await tx.shopItem.delete({ where: { id } })
      await audit(tx, { actorId, action: 'DELETE', item: { id, name: before.name }, before: snapshot(before) })
      return { deleted: true as const, name: before.name }
    })
  } catch (e) {
    // An Inventory row that slipped in (FK) still blocks the delete.
    if (isPrismaCode(e, 'P2003')) {
      throw new ConflictError('This item has been bought, held or granted, so it can only be hidden, not deleted')
    }
    throw e
  }
}

// ----------------------------------------------------- grant / remove ---

export interface AdminGrantInput {
  discordId: string
  itemId: number
  quantity: unknown
  reason: unknown
  /** Idempotency key from the form; a replay with the same id grants nothing. */
  requestId?: unknown
}

export type AdminGrantResult =
  | { status: 'credited' | 'held'; grantKey: string; itemName: string; quantity: number }
  | { status: 'duplicate'; grantKey: string; itemName: string; quantity: number }

/**
 * Give a member an item (any item: hidden and collectible ones too). Written
 * as an ItemGrant (source "admin", note = reason). A member with an app
 * account gets it in Inventory now; one without is held PENDING and credited
 * on their first login / onboarding (creditPendingItemGrants), exactly like
 * grant-items.mjs.
 */
export async function adminGrantItem(actorId: string, input: AdminGrantInput): Promise<AdminGrantResult> {
  checkActor(actorId)
  if (!DISCORD_ID.test(input.discordId)) throw new ValidationError('Invalid member', 'recipient')
  const quantity = validateQty(input.quantity)
  const reason = validateReason(input.reason)
  const grantKey = `${ADMIN_GRANT_SOURCE}:${validateRequestId(input.requestId)}`
  const { discordId, itemId } = input

  return prisma.$transaction(async (tx) => {
    const item = await tx.shopItem.findUnique({ where: { id: itemId }, select: { id: true, name: true } })
    if (!item) throw new NotFoundError('Item')
    const hasAccount = !!(await tx.user.findUnique({ where: { id: discordId }, select: { id: true } }))
    const ins = await tx.itemGrant.createMany({
      data: [
        {
          grantKey,
          source: ADMIN_GRANT_SOURCE,
          discordId,
          itemId,
          quantity,
          note: `${reason} (by ${actorId})`.slice(0, 500),
          status: hasAccount ? 'CREDITED' : 'PENDING',
          creditedAt: hasAccount ? new Date() : null,
        },
      ],
      skipDuplicates: true,
    })
    if (ins.count !== 1) return { status: 'duplicate' as const, grantKey, itemName: item.name, quantity }
    if (hasAccount) {
      await tx.inventory.upsert({
        where: { userId_itemId: { userId: discordId, itemId } },
        create: { userId: discordId, itemId, quantity },
        update: { quantity: { increment: quantity } },
      })
    }
    const status = hasAccount ? ('credited' as const) : ('held' as const)
    await audit(tx, {
      actorId,
      action: 'GRANT',
      item,
      targetId: discordId,
      quantity,
      after: { status: hasAccount ? 'CREDITED' : 'PENDING', grantKey },
      reason,
    })
    return { status, grantKey, itemName: item.name, quantity }
  })
}

export interface AdminRemoveInput {
  discordId: string
  itemId: number
  quantity: unknown
  reason: unknown
}

/**
 * Take units of an item out of a member's inventory. A conditional decrement
 * (quantity >= n): concurrent removals can never take it below 0; whichever
 * finds too few is refused and changes nothing. An emptied row is deleted.
 */
export async function adminRemoveItem(
  actorId: string,
  input: AdminRemoveInput,
): Promise<{ itemName: string; removed: number; remaining: number }> {
  checkActor(actorId)
  if (!DISCORD_ID.test(input.discordId)) throw new ValidationError('Invalid member', 'recipient')
  const quantity = validateQty(input.quantity)
  const reason = validateReason(input.reason)
  const { discordId: userId, itemId } = input

  return prisma.$transaction(async (tx) => {
    const item = await tx.shopItem.findUnique({ where: { id: itemId }, select: { id: true, name: true } })
    if (!item) throw new NotFoundError('Item')
    const dec = await tx.inventory.updateMany({
      where: { userId, itemId, quantity: { gte: quantity } },
      data: { quantity: { decrement: quantity } },
    })
    if (dec.count !== 1) {
      const held = (await tx.inventory.findUnique({ where: { userId_itemId: { userId, itemId } } }))?.quantity ?? 0
      throw new ValidationError(`They only hold ${held} ${item.name}`, 'quantity')
    }
    const remaining = (await tx.inventory.findUniqueOrThrow({ where: { userId_itemId: { userId, itemId } } })).quantity
    if (remaining === 0) await tx.inventory.deleteMany({ where: { userId, itemId, quantity: 0 } })
    await audit(tx, {
      actorId,
      action: 'REMOVE',
      item,
      targetId: userId,
      quantity,
      before: { held: remaining + quantity },
      after: { held: remaining },
      reason,
    })
    return { itemName: item.name, removed: quantity, remaining }
  })
}

// ------------------------------------------------------------ reading ---

export interface ShopAdminItem {
  id: number
  name: string
  description: string | null
  price: number
  quantity: number
  image: string | null
  isAvailable: boolean
  isCollectible: boolean
  createdAt: string
  /** Units bought (SHOP_PURCHASE ledger rows). */
  sold: number
  /** Units in members' inventories. */
  held: number
  /** Units granted but held PENDING until the member signs up. */
  pending: number
  /** No purchases, holdings, grants or ledger rows: may be hard-deleted. */
  canDelete: boolean
}

export interface ShopAdminEventView {
  id: number
  actorId: string
  action: ShopAdminAction
  itemId: number | null
  itemName: string
  targetId: string | null
  quantity: number | null
  before: unknown
  after: unknown
  reason: string | null
  createdAt: string
}

/** Everything /admin/shop shows: items with sales / holdings, and the latest audit rows. */
export async function getShopAdminOverview(eventLimit = 100): Promise<{ items: ShopAdminItem[]; events: ShopAdminEventView[] }> {
  const [items, held, grants, ledger, events] = await Promise.all([
    prisma.shopItem.findMany({ orderBy: [{ isCollectible: 'asc' }, { name: 'asc' }] }),
    prisma.inventory.groupBy({ by: ['itemId'], _sum: { quantity: true } }),
    prisma.itemGrant.groupBy({ by: ['itemId', 'status'], _sum: { quantity: true }, _count: { _all: true } }),
    prisma.$queryRaw<Array<{ itemId: number; rows: number; sold: number }>>`
      SELECT (metadata->>'itemId')::int AS "itemId",
             COUNT(*)::int AS "rows",
             COALESCE(SUM(
               CASE WHEN type = 'SHOP_PURCHASE'
                 THEN CASE WHEN metadata->>'quantity' ~ '^[0-9]{1,9}$' THEN (metadata->>'quantity')::int ELSE 1 END
                 ELSE 0 END
             ), 0)::int AS "sold"
      FROM "Transaction"
      WHERE metadata->>'itemId' ~ '^[0-9]{1,9}$'
      GROUP BY 1`,
    prisma.shopAdminEvent.findMany({ orderBy: { id: 'desc' }, take: eventLimit }),
  ])

  const heldBy = new Map(held.map((h) => [h.itemId, h._sum.quantity ?? 0]))
  const pendingBy = new Map<number, number>()
  const grantRows = new Map<number, number>()
  for (const g of grants) {
    grantRows.set(g.itemId, (grantRows.get(g.itemId) ?? 0) + g._count._all)
    if (g.status === 'PENDING') pendingBy.set(g.itemId, (pendingBy.get(g.itemId) ?? 0) + (g._sum.quantity ?? 0))
  }
  const ledgerBy = new Map(ledger.map((l) => [Number(l.itemId), { rows: Number(l.rows), sold: Number(l.sold) }]))
  const holderRows = new Set(held.map((h) => h.itemId))

  return {
    items: items.map((i) => {
      const l = ledgerBy.get(i.id)
      return {
        id: i.id,
        name: i.name,
        description: i.description,
        price: i.price,
        quantity: i.quantity,
        image: i.image,
        isAvailable: i.isAvailable,
        isCollectible: i.isCollectible,
        createdAt: i.createdAt.toISOString(),
        sold: l?.sold ?? 0,
        held: heldBy.get(i.id) ?? 0,
        pending: pendingBy.get(i.id) ?? 0,
        canDelete: !holderRows.has(i.id) && !grantRows.get(i.id) && !l?.rows,
      }
    }),
    events: events.map((e) => ({
      id: e.id,
      actorId: e.actorId,
      action: e.action,
      itemId: e.itemId,
      itemName: e.itemName,
      targetId: e.targetId,
      quantity: e.quantity,
      before: e.before,
      after: e.after,
      reason: e.reason,
      createdAt: e.createdAt.toISOString(),
    })),
  }
}

/** How many of `itemId` a member holds now, and how many are held pending signup. */
export async function getMemberHolding(discordId: string, itemId: number) {
  const [inv, pending] = await Promise.all([
    prisma.inventory.findUnique({ where: { userId_itemId: { userId: discordId, itemId } } }),
    prisma.itemGrant.aggregate({ where: { discordId, itemId, status: 'PENDING' }, _sum: { quantity: true } }),
  ])
  return { held: inv?.quantity ?? 0, pending: pending._sum.quantity ?? 0 }
}
