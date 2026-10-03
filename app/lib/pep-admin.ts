/**
 * Admin money commands: Discord /add-money and /remove-money (they replace
 * UnbelievaBoat's add-money / remove-money; see plans/unbelievaboat-replacement.md §7.3).
 *
 * Both go through the hardened ledger helpers: the wallet change and its
 * ADMIN_GRANT (+) / ADMIN_REMOVE (-) Transaction row commit together, and a
 * removal is a conditional decrement (wallet >= amount), so it can never take a
 * balance below 0, however many run at once. Whoever calls these must already
 * have checked that the caller is an admin (the interactions handler checks
 * member.roles against ADMIN_ROLE_IDS).
 */
import { prisma } from './db'
import { ValidationError } from './errors/api-errors'
import { creditInTx, debitInTx, getOrCreateEconomy } from './economy'

export const ADMIN_REASON_MIN = 3
export const ADMIN_REASON_MAX = 200
const DEFAULT_GRANT_MAX = 10_000

/** Largest single /add-money or /remove-money (env ADMIN_GRANT_MAX, default 10000). */
export function adminGrantMax(env: Record<string, string | undefined> = process.env): number {
  const v = Number(env.ADMIN_GRANT_MAX)
  return Number.isInteger(v) && v > 0 && v <= 2_147_483_647 ? v : DEFAULT_GRANT_MAX
}

/** Collapse whitespace so a reason is one line. */
export function normalizeReason(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : ''
}

/** Returns a user-facing error, or null when amount and reason are valid. */
export function adminGrantError(amount: unknown, reason: string, max = adminGrantMax()): string | null {
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    return 'Amount must be a positive whole number.'
  }
  if (amount > max) return `Amount can be at most ${max.toLocaleString('en-US')}.`
  if (reason.length < ADMIN_REASON_MIN || reason.length > ADMIN_REASON_MAX) {
    return `Reason must be ${ADMIN_REASON_MIN}-${ADMIN_REASON_MAX} characters.`
  }
  return null
}

export type AdminAdjustResult =
  | { ok: true; amount: number; balance: number }
  | { ok: false; reason: 'insufficient'; balance: number }

function check(adminId: string, targetId: string, amount: number, rawReason: string) {
  const reason = normalizeReason(rawReason)
  const err = adminGrantError(amount, reason)
  if (err) throw new ValidationError(err)
  if (!/^\d{5,25}$/.test(adminId) || !/^\d{5,25}$/.test(targetId)) throw new ValidationError('Invalid member')
  return reason
}

const meta = (adminId: string, reason: string) => ({ adminId, reason, source: 'discord' })

/** /add-money: credit `targetId` (creating their User/Economy rows if needed, like /pay does for recipients). */
export async function adminAddMoney(adminId: string, targetId: string, amount: number, rawReason: string): Promise<AdminAdjustResult> {
  const reason = check(adminId, targetId, amount, rawReason)
  await getOrCreateEconomy(targetId)
  const balance = await prisma.$transaction(async (tx) => {
    await creditInTx(tx, targetId, amount, 'ADMIN_GRANT', `Admin grant by ${adminId}: ${reason}`, meta(adminId, reason))
    return (await tx.economy.findUniqueOrThrow({ where: { id: targetId }, select: { wallet: true } })).wallet
  })
  return { ok: true, amount, balance }
}

/**
 * /remove-money: debit `targetId`, never below 0. Refuses (nothing removed)
 * with the current balance when the wallet doesn't cover `amount`. A member
 * with no wallet has 0, so nothing is created for them.
 */
export async function adminRemoveMoney(adminId: string, targetId: string, amount: number, rawReason: string): Promise<AdminAdjustResult> {
  const reason = check(adminId, targetId, amount, rawReason)
  const current = async () =>
    (await prisma.economy.findUnique({ where: { id: targetId }, select: { wallet: true } }))?.wallet ?? 0
  const before = await current()
  if (before < amount) return { ok: false, reason: 'insufficient', balance: before }
  try {
    const balance = await prisma.$transaction(async (tx) => {
      // Conditional decrement (wallet >= amount) in debitInTx is the authority.
      await debitInTx(tx, targetId, amount, 'ADMIN_REMOVE', `Admin removal by ${adminId}: ${reason}`, meta(adminId, reason))
      return (await tx.economy.findUniqueOrThrow({ where: { id: targetId }, select: { wallet: true } })).wallet
    })
    return { ok: true, amount, balance }
  } catch (e) {
    if (e instanceof ValidationError && e.message === 'Insufficient funds') {
      return { ok: false, reason: 'insufficient', balance: await current() }
    }
    throw e
  }
}
