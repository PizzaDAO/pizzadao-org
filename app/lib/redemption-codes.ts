/**
 * Proof of Pizza redemption codes (plans/proof-of-pizza-codes.md).
 *
 * Each held unit of the configured shop item (setting proofOfPizza.itemId, 0 = off) carries one
 * 4-character code. Invariant: count(ACTIVE codes for member + item) == Inventory.quantity.
 *
 * reconcileRedemptionCodes() restores it: it mints missing codes and voids extras (newest first).
 * It must run inside the same transaction as every inventory write (a guard test lists the write
 * sites). Redeeming a code consumes the unit and marks the code REDEEMED in one transaction.
 *
 * Members' codes are secrets: never put them on public pages or in logs.
 */
import { randomInt } from 'node:crypto'
import { prisma } from './db'
import { getSetting } from './settings'
import { labelPeople } from './shop-admin-people'

/** No 0/O/1/I/L. 31 characters, so 31^4 = 923,521 codes. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export const CODE_LENGTH = 4
const CODE_RE = /^[2-9A-HJKMNP-Z]{4}$/
export const REDEEM_REF_PREFIX = 'proofofpizza:'
const MINT_ATTEMPTS = 6

/** The Prisma transaction client (loosely typed so this module needs no regenerated client to compile). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Tx = any

export function generateCode(): string {
  let out = ''
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return out
}

/** Trim, uppercase, drop spaces and dashes. Null when it is not a well-formed code. */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 40) return null
  const c = raw.trim().toUpperCase().replace(/[\s-]+/g, '')
  return CODE_RE.test(c) ? c : null
}

/** A submission reference from the other site: a short id, stored with a fixed prefix. */
export function normalizeRef(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const r = raw.trim()
  return /^[A-Za-z0-9_-]{1,64}$/.test(r) ? `${REDEEM_REF_PREFIX}${r}` : null
}

export interface ReconcileOptions {
  /** Only reconcile when this is the configured item (cheap exit for every other purchase or send). */
  touchedItemId?: number
  /** Why extras are voided: 'sent' | 'removed' | 'reconcile'. */
  voidReason?: string
  /** When the units were acquired (backfill passes the purchase time). */
  acquiredAt?: Date
  /** Test seam. */
  generate?: () => string
}

export interface ReconcileResult {
  minted: string[]
  voided: number
}

const NONE: ReconcileResult = { minted: [], voided: 0 }

/** Serialize all code changes for one member for the rest of the transaction. */
async function lockMember(tx: Tx, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'redeem:' + userId}))`
}

async function configuredItemId(): Promise<number> {
  try {
    return Number(await getSetting('proofOfPizza.itemId')) || 0
  } catch {
    return 0
  }
}

/** Mint `count` codes for the member, retrying on collisions. A failed INSERT would abort the transaction, so no try/catch. */
async function mint(tx: Tx, userId: string, itemId: number, count: number, opts: ReconcileOptions): Promise<string[]> {
  const gen = opts.generate ?? generateCode
  const got: string[] = []
  for (let attempt = 0; attempt < MINT_ATTEMPTS && got.length < count; attempt++) {
    const want = count - got.length
    const candidates = new Set<string>()
    for (let i = 0; i < want * 3 + 3 && candidates.size < want; i++) candidates.add(gen())
    const list = [...candidates]
    const taken = new Set<string>(
      (await tx.redemptionCode.findMany({ where: { code: { in: list } }, select: { code: true } })).map((r: { code: string }) => r.code),
    )
    const fresh = list.filter((c) => !taken.has(c)).slice(0, want)
    if (fresh.length === 0) continue
    await tx.redemptionCode.createMany({
      data: fresh.map((code) => ({ code, itemId, discordId: userId, ...(opts.acquiredAt ? { acquiredAt: opts.acquiredAt } : {}) })),
      skipDuplicates: true,
    })
    // Another member's concurrent insert of the same code is skipped; keep only the rows that are ours.
    const mine = await tx.redemptionCode.findMany({
      where: { code: { in: fresh }, discordId: userId, itemId, status: 'ACTIVE' },
      select: { code: true },
    })
    for (const r of mine as Array<{ code: string }>) got.push(r.code)
  }
  if (got.length < count) throw new Error('Could not mint enough unique redemption codes')
  return got
}

/** Make the member's ACTIVE codes match their inventory of the configured item. Call inside the inventory transaction. */
export async function reconcileRedemptionCodes(tx: Tx, userId: string, opts: ReconcileOptions = {}): Promise<ReconcileResult> {
  const itemId = await configuredItemId()
  if (!itemId) return NONE
  if (opts.touchedItemId !== undefined && opts.touchedItemId !== itemId) return NONE
  await lockMember(tx, userId)
  return reconcileLocked(tx, userId, itemId, opts)
}

async function reconcileLocked(tx: Tx, userId: string, itemId: number, opts: ReconcileOptions): Promise<ReconcileResult> {
  const inv = await tx.inventory.findUnique({ where: { userId_itemId: { userId, itemId } }, select: { quantity: true } })
  const held = Math.max(0, inv?.quantity ?? 0)
  const active: Array<{ id: number }> = await tx.redemptionCode.findMany({
    where: { discordId: userId, itemId, status: 'ACTIVE' },
    orderBy: { id: 'asc' },
    select: { id: true },
  })
  if (active.length < held) return { minted: await mint(tx, userId, itemId, held - active.length, opts), voided: 0 }
  if (active.length > held) {
    const extra = active.slice(held).map((r) => r.id) // newest first out: the oldest codes stay valid
    const res = await tx.redemptionCode.updateMany({
      where: { id: { in: extra }, status: 'ACTIVE' },
      data: { status: 'VOID', voidedAt: new Date(), voidReason: opts.voidReason ?? 'reconcile' },
    })
    return { minted: [], voided: res.count }
  }
  return NONE
}

export interface MyCodes {
  enabled: boolean
  siteUrl: string
  active: Array<{ code: string; acquiredAt: string }>
  redeemed: Array<{ code: string; redeemedAt: string }>
}

/** The member's own codes (self-heals first). Empty and disabled while the feature is off. */
export async function getMyCodes(userId: string): Promise<MyCodes> {
  const itemId = await configuredItemId()
  const siteUrl = String(await getSetting('proofOfPizza.siteUrl').catch(() => 'https://proofof.pizza'))
  if (!itemId) return { enabled: false, siteUrl, active: [], redeemed: [] }
  await prisma.$transaction(async (tx: Tx) => {
    await reconcileRedemptionCodes(tx, userId)
  })
  const [active, redeemed] = await Promise.all([
    prisma.redemptionCode.findMany({ where: { discordId: userId, itemId, status: 'ACTIVE' }, orderBy: { id: 'asc' }, select: { code: true, acquiredAt: true } }),
    prisma.redemptionCode.findMany({
      where: { discordId: userId, itemId, status: 'REDEEMED' },
      orderBy: { redeemedAt: 'desc' },
      take: 10,
      select: { code: true, redeemedAt: true },
    }),
  ])
  return {
    enabled: true,
    siteUrl,
    active: active.map((c: { code: string; acquiredAt: Date }) => ({ code: c.code, acquiredAt: c.acquiredAt.toISOString() })),
    redeemed: redeemed.map((c: { code: string; redeemedAt: Date | null }) => ({ code: c.code, redeemedAt: (c.redeemedAt ?? new Date(0)).toISOString() })),
  }
}

export type LookupResult =
  | { status: 'unknown' }
  | { status: 'void' }
  | { status: 'redeemed'; redeemedAt: string | null; redeemedRef: string | null }
  | { status: 'active'; holderName: string | null; acquiredAt: string }

/**
 * Code status for the other site's admin. 'active' only while the holder still holds the unit
 * (the holder is reconciled first); anything else that cannot be redeemed is 'void' or 'unknown'.
 */
export async function lookupCode(code: string): Promise<LookupResult> {
  const itemId = await configuredItemId()
  const row = await prisma.$transaction(async (tx: Tx) => {
    const first = await tx.redemptionCode.findUnique({ where: { code } })
    if (!first) return null
    if (first.status !== 'ACTIVE') return first
    await lockMember(tx, first.discordId)
    if (itemId) await reconcileLocked(tx, first.discordId, itemId, {})
    return tx.redemptionCode.findUnique({ where: { code } })
  })
  if (!row) return { status: 'unknown' }
  if (row.status === 'REDEEMED') {
    return { status: 'redeemed', redeemedAt: row.redeemedAt ? row.redeemedAt.toISOString() : null, redeemedRef: row.redeemedRef ?? null }
  }
  if (row.status !== 'ACTIVE' || !itemId || row.itemId !== itemId) return { status: 'void' }
  const labels = await labelPeople([row.discordId]).catch(() => ({}) as Record<string, { name: string }>)
  return { status: 'active', holderName: labels[row.discordId]?.name ?? null, acquiredAt: row.acquiredAt.toISOString() }
}

export type RedeemResult =
  | { status: 'redeemed'; redeemedAt: string }
  | { status: 'already'; redeemedAt: string | null }
  | { status: 'conflict' } // used by a different submission
  | { status: 'not_found' } // unknown, void, or the unit is gone

class NotRedeemable extends Error {}

/**
 * Redeem a code for a submission: code -> REDEEMED and one unit out of the holder's inventory, in one
 * transaction. Idempotent on the same ref; a different ref on a used code is a conflict.
 */
export async function redeemCode(code: string, ref: string): Promise<RedeemResult> {
  const itemId = await configuredItemId()
  if (!itemId) return { status: 'not_found' }
  try {
    return await prisma.$transaction(async (tx: Tx): Promise<RedeemResult> => {
      const peek = await tx.redemptionCode.findUnique({ where: { code }, select: { discordId: true } })
      if (!peek) return { status: 'not_found' }
      await lockMember(tx, peek.discordId)
      let row = await tx.redemptionCode.findUnique({ where: { code } })
      if (!row) return { status: 'not_found' }
      if (row.status === 'REDEEMED') {
        return row.redeemedRef === ref ? { status: 'already', redeemedAt: row.redeemedAt ? row.redeemedAt.toISOString() : null } : { status: 'conflict' }
      }
      if (row.status !== 'ACTIVE' || row.itemId !== itemId) return { status: 'not_found' }
      // The holder may have lost the unit without this code being voided yet.
      await reconcileLocked(tx, row.discordId, itemId, {})
      row = await tx.redemptionCode.findUnique({ where: { code } })
      if (!row || row.status !== 'ACTIVE') return { status: 'not_found' }

      const now = new Date()
      const won = await tx.redemptionCode.updateMany({
        where: { id: row.id, status: 'ACTIVE' },
        data: { status: 'REDEEMED', redeemedAt: now, redeemedRef: ref },
      })
      if (won.count !== 1) throw new NotRedeemable()
      const dec = await tx.inventory.updateMany({
        where: { userId: row.discordId, itemId, quantity: { gte: 1 } },
        data: { quantity: { decrement: 1 } },
      })
      if (dec.count !== 1) throw new NotRedeemable() // rolls the status change back
      await tx.inventory.deleteMany({ where: { userId: row.discordId, itemId, quantity: { lte: 0 } } })
      return { status: 'redeemed', redeemedAt: now.toISOString() }
    })
  } catch (e) {
    if (e instanceof NotRedeemable) return { status: 'not_found' }
    // Unique violation on redeemedRef: this submission already redeemed a different code.
    if ((e as { code?: string })?.code === 'P2002') return { status: 'conflict' }
    throw e
  }
}
