/**
 * Admin money commands: Discord /add-money and /remove-money (they replace
 * UnbelievaBoat's add-money / remove-money; see plans/unbelievaboat-replacement.md §7.3).
 *
 * Both go through the hardened ledger helpers: the wallet change and its
 * ADMIN_GRANT (+) / ADMIN_REMOVE (-) Transaction row commit together, and a
 * removal is a conditional decrement (wallet >= amount), so it can never take a
 * balance below 0, however many run at once. Whoever calls these must already
 * have checked that the caller may use them (isPepAdmin, on member.roles).
 */
import { prisma } from './db'
import { ValidationError } from './errors/api-errors'
import { creditInTx, debitInTx, getOrCreateEconomy } from './economy'
import { normalizeRoleName } from './pep-earn/income'

// ------------------------------------------------------------ who may use ---

/** Known role ids by normalized name, used when the guild role list can't resolve a name. */
const PINNED_ROLE_IDS: Record<string, string> = {
  pepperonimafia: '823266914834841610', // Pepperoni Mafia (also in app/ui/constants.ts)
}
const DEFAULT_ROLE_NAMES = ['Pepperoni Mafia']
const ID = /^\d{5,25}$/

const list = (raw: string | undefined) =>
  (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

/**
 * Extra roles allowed to run /add-money and /remove-money, besides
 * ADMIN_ROLE_IDS: PEP_ADMIN_ROLE_IDS (comma-separated ids) and
 * PEP_ADMIN_ROLE_NAMES (comma-separated names, default "Pepperoni Mafia").
 * Set PEP_ADMIN_ROLE_NAMES to "-" for no named roles.
 */
export function pepAdminRoleConfig(env: Record<string, string | undefined> = process.env): { ids: string[]; names: string[] } {
  const ids = list(env.PEP_ADMIN_ROLE_IDS).filter((id) => ID.test(id))
  const rawNames = env.PEP_ADMIN_ROLE_NAMES?.trim()
  const names = rawNames === '-' ? [] : rawNames ? list(rawNames) : DEFAULT_ROLE_NAMES
  return { ids, names }
}

/**
 * Whether a member (by the role ids in the interaction payload) may use the
 * admin money commands. Fixed ids are checked first; only if none match are
 * the configured names resolved against the guild role list (getGuildRoles is
 * cached for an hour, so this is normally no API call). A name matching zero
 * or several guild roles falls back to its pinned id, if any, never a guess.
 */
export async function isPepAdmin(
  memberRoles: readonly string[],
  opts: {
    baseRoleIds: readonly string[]
    config?: { ids: string[]; names: string[] }
    getGuildRoles?: () => Promise<ReadonlyArray<{ id: string; name: string }> | null>
  },
): Promise<boolean> {
  if (memberRoles.length === 0) return false
  const config = opts.config ?? pepAdminRoleConfig()
  const held = new Set(memberRoles)
  if ([...opts.baseRoleIds, ...config.ids].some((id) => held.has(id))) return true
  if (config.names.length === 0) return false
  const roles = (await opts.getGuildRoles?.().catch(() => null)) ?? null
  for (const name of config.names) {
    const key = normalizeRoleName(name)
    const matches = (roles ?? []).filter((r) => normalizeRoleName(r.name) === key).map((r) => r.id)
    const id = matches.length === 1 ? matches[0] : PINNED_ROLE_IDS[key]
    if (id && held.has(id)) return true
  }
  return false
}

// ---------------------------------------------------------------- grants ---

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
