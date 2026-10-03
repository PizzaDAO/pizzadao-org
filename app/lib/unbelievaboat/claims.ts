/**
 * Database side of the UnbelievaBoat -> $PEP migration.
 *
 * Every migrated user gets one PendingPepClaim row (unique migrationKey).
 * Crediting moves a claim PENDING -> CREDITED with a conditional update inside
 * the same transaction that increments Economy.wallet and writes the ledger
 * row via the app's own logTransaction(), so:
 *   - re-running the import cannot double-credit (the conditional update
 *     matches 0 rows the second time);
 *   - a crash mid-run leaves each claim either fully credited or untouched;
 *   - a login-time claim racing the import is safe for the same reason.
 *
 * Does not modify app/lib/economy.ts; it composes getOrCreateEconomy() and
 * logTransaction() the same way transfer()/recordDailyJobCompletion() do.
 */
import { prisma } from '../db'
import { getOrCreateEconomy } from '../economy'
import { logTransaction } from '../transactions'
import { MIGRATION_REASON, MIGRATION_SOURCE, type MigrationPlan, type PlanEntry } from './plan'

const CHUNK = 500

function chunks<T>(arr: T[], n = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

function toBigInt(s: string): bigint {
  return /^-?\d+$/.test(s) ? BigInt(s) : BigInt(0)
}

export interface StageResult {
  created: number
  alreadyStaged: number
  /** Existing claims whose amount differs from this plan (e.g. a later snapshot). Never overwritten. */
  conflicts: Array<{ migrationKey: string; existingAmount: number; planAmount: number; existingStatus: string }>
}

/**
 * Insert a PENDING claim for every credit/pending entry. Existing rows (same
 * migrationKey) are left exactly as they are.
 */
export async function stageClaims(plan: MigrationPlan, snapshotSha: string): Promise<StageResult> {
  const entries = plan.entries.filter((e) => e.status === 'credit' || e.status === 'pending')
  let created = 0
  for (const part of chunks(entries)) {
    const res = await prisma.pendingPepClaim.createMany({
      data: part.map((e) => ({
        migrationKey: e.migrationKey,
        source: MIGRATION_SOURCE,
        discordId: e.discordId,
        amount: e.amount,
        sourceCash: toBigInt(e.cash),
        sourceBank: toBigInt(e.bank),
        snapshotSha,
      })),
      skipDuplicates: true,
    })
    created += res.count
  }

  const conflicts: StageResult['conflicts'] = []
  const byKey = new Map(entries.map((e) => [e.migrationKey, e]))
  for (const part of chunks([...byKey.keys()])) {
    const existing = await prisma.pendingPepClaim.findMany({
      where: { migrationKey: { in: part } },
      select: { migrationKey: true, amount: true, status: true },
    })
    for (const c of existing) {
      const e = byKey.get(c.migrationKey)
      if (e && e.amount !== c.amount) {
        conflicts.push({ migrationKey: c.migrationKey, existingAmount: c.amount, planAmount: e.amount, existingStatus: c.status })
      }
    }
  }
  return { created, alreadyStaged: entries.length - created, conflicts }
}

export type CreditOutcome =
  | { status: 'credited'; discordId: string; amount: number; transactionId: number }
  | { status: 'already'; discordId: string; amount: number }
  | { status: 'missing'; migrationKey: string }

/** Credit one staged claim. Idempotent. */
export async function creditClaim(migrationKey: string): Promise<CreditOutcome> {
  const claim = await prisma.pendingPepClaim.findUnique({ where: { migrationKey } })
  if (!claim) return { status: 'missing', migrationKey }
  if (claim.status !== 'PENDING') return { status: 'already', discordId: claim.discordId, amount: claim.amount }

  // Creates the User + Economy rows if this Discord user has never used the app.
  await getOrCreateEconomy(claim.discordId)

  return prisma.$transaction(async (tx) => {
    const won = await tx.pendingPepClaim.updateMany({
      where: { migrationKey, status: 'PENDING' },
      data: { status: 'CREDITED', creditedAt: new Date() },
    })
    if (won.count !== 1) return { status: 'already' as const, discordId: claim.discordId, amount: claim.amount }

    await tx.economy.update({
      where: { id: claim.discordId },
      data: { wallet: { increment: claim.amount } },
    })
    const ledger = await logTransaction(tx, claim.discordId, 'MIGRATION_CREDIT', claim.amount, MIGRATION_REASON, {
      source: claim.source,
      migrationKey,
      snapshotSha: claim.snapshotSha,
      sourceCash: claim.sourceCash.toString(),
      sourceBank: claim.sourceBank.toString(),
    })
    await tx.pendingPepClaim.update({ where: { migrationKey }, data: { transactionId: ledger.id } })
    return { status: 'credited' as const, discordId: claim.discordId, amount: claim.amount, transactionId: ledger.id }
  })
}

export interface CreditRunResult {
  credited: number
  already: number
  missing: number
  failed: Array<{ migrationKey: string; error: string }>
  pepCredited: number
  /** migrationKeys credited by this call (for reconciliation). */
  creditedKeys: string[]
}

/** Credit every `credit` entry of a plan (members). Pending entries wait for login. */
export async function creditMatched(
  entries: PlanEntry[],
  onProgress?: (done: number, total: number) => void,
): Promise<CreditRunResult> {
  const todo = entries.filter((e) => e.status === 'credit')
  const out: CreditRunResult = { credited: 0, already: 0, missing: 0, failed: [], pepCredited: 0, creditedKeys: [] }
  let i = 0
  for (const e of todo) {
    try {
      const r = await creditClaim(e.migrationKey)
      if (r.status === 'credited') {
        out.credited++
        out.pepCredited += r.amount
        out.creditedKeys.push(e.migrationKey)
      } else if (r.status === 'already') out.already++
      else out.missing++
    } catch (err) {
      out.failed.push({ migrationKey: e.migrationKey, error: (err as Error).message })
    }
    onProgress?.(++i, todo.length)
  }
  return out
}

/** Credit any pending migration claims held for this Discord user. Idempotent. */
export async function claimPendingPepForUser(discordId: string): Promise<{ credited: number; amount: number }> {
  const pending = await prisma.pendingPepClaim.findMany({
    where: { discordId, status: 'PENDING' },
    select: { migrationKey: true },
  })
  let credited = 0
  let amount = 0
  for (const p of pending) {
    const r = await creditClaim(p.migrationKey)
    if (r.status === 'credited') {
      credited++
      amount += r.amount
    }
  }
  return { credited, amount }
}

/**
 * Login hook. No-op unless PEP_MIGRATION_CLAIMS=1 (set it only after the
 * migration is deployed and the import has staged claims). Never throws.
 */
export async function claimPendingPepOnLogin(discordId: string): Promise<void> {
  if (process.env.PEP_MIGRATION_CLAIMS !== '1' || !discordId) return
  try {
    const r = await claimPendingPepForUser(discordId)
    if (r.credited) console.log(`[pep-migration] credited ${r.amount} PEP to ${discordId} on login`)
  } catch (err) {
    console.error('[pep-migration] login claim failed (non-blocking):', err)
  }
}

export type ReverseOutcome =
  | { status: 'reversed'; discordId: string; amount: number; debited: number; shortfall: number }
  | { status: 'voided'; discordId: string; amount: number }
  | { status: 'skipped'; reason: string }

/**
 * Roll back one claim. PENDING -> VOID. CREDITED -> REVERSED, debiting the
 * credited amount (or the whole wallet if the user already spent part of it;
 * the unrecovered part is reported as `shortfall`, never driven negative).
 */
export async function reverseClaim(migrationKey: string): Promise<ReverseOutcome> {
  const claim = await prisma.pendingPepClaim.findUnique({ where: { migrationKey } })
  if (!claim) return { status: 'skipped', reason: 'missing' }

  if (claim.status === 'PENDING') {
    const r = await prisma.pendingPepClaim.updateMany({
      where: { migrationKey, status: 'PENDING' },
      data: { status: 'VOID', reversedAt: new Date() },
    })
    return r.count === 1 ? { status: 'voided', discordId: claim.discordId, amount: claim.amount } : { status: 'skipped', reason: 'raced' }
  }
  if (claim.status !== 'CREDITED') return { status: 'skipped', reason: `status ${claim.status}` }

  return prisma.$transaction(async (tx) => {
    const won = await tx.pendingPepClaim.updateMany({
      where: { migrationKey, status: 'CREDITED' },
      data: { status: 'REVERSED', reversedAt: new Date() },
    })
    if (won.count !== 1) return { status: 'skipped' as const, reason: 'raced' }
    const econ = await tx.economy.findUnique({ where: { id: claim.discordId } })
    const wallet = econ?.wallet ?? 0
    const debit = Math.min(claim.amount, Math.max(0, wallet))
    if (debit > 0) {
      const d = await tx.economy.updateMany({
        where: { id: claim.discordId, wallet: { gte: debit } },
        data: { wallet: { decrement: debit } },
      })
      if (d.count !== 1) throw new Error(`wallet changed during reversal of ${migrationKey}`)
    }
    await logTransaction(tx, claim.discordId, 'MIGRATION_REVERSAL', -debit, `${MIGRATION_REASON} (reversed)`, {
      source: claim.source,
      migrationKey,
      creditTransactionId: claim.transactionId,
      shortfall: claim.amount - debit,
    })
    return { status: 'reversed' as const, discordId: claim.discordId, amount: claim.amount, debited: debit, shortfall: claim.amount - debit }
  })
}

/** Discord IDs that have an app account (User row). */
export async function getAppUserIds(): Promise<Set<string>> {
  const rows = await prisma.user.findMany({ select: { id: true } })
  return new Set(rows.map((r) => r.id))
}

/** Current wallet balance for each id (0 when no Economy row). */
export async function getWallets(discordIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>(discordIds.map((id) => [id, 0]))
  for (const part of chunks(discordIds)) {
    const rows = await prisma.economy.findMany({ where: { id: { in: part } }, select: { id: true, wallet: true } })
    for (const r of rows) out.set(r.id, r.wallet)
  }
  return out
}

/** Claim rows for a source, keyed by migrationKey. */
export async function getClaims(source = MIGRATION_SOURCE) {
  const rows = await prisma.pendingPepClaim.findMany({ where: { source } })
  return new Map(rows.map((r) => [r.migrationKey, r]))
}
