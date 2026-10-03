/**
 * Turn an UnbelievaBoat snapshot into a migration plan: who gets how much
 * PEP, who is held as a pending claim, and who is skipped (and why).
 *
 * Pure: no DB/network. The import script feeds it the set of known members.
 */
import { isFiniteAmount, type Snapshot, type SnapshotUser } from './snapshot'

/** Postgres INTEGER max; Economy.wallet and Transaction.amount are Int. */
export const PEP_INT_MAX = 2_147_483_647

export const MIGRATION_SOURCE = 'unbelievaboat'
export const MIGRATION_REASON = 'UnbelievaBoat migration'

export type Basis = 'total' | 'cash' | 'bank'

export interface PlanOptions {
  /**
   * PEP per 1 UB unit, as a decimal string ("1", "0.01", "2.5"). Applied with
   * exact integer math and rounded down (floor) per user. Default "1".
   */
  rate?: string
  /** Which UB balance to convert. Default "total" (cash + bank). */
  basis?: Basis
  /** Discord IDs to skip outright (bots, test/admin accounts, the treasury). */
  exclude?: Iterable<string>
  /** Users whose converted amount is below this get nothing. Default 1. */
  minAmount?: number
}

export type EntryStatus =
  | 'credit' // known member: credit at import
  | 'pending' // not a member yet: hold as a pending claim keyed by discordId
  | 'zero' // nothing to migrate
  | 'negative' // UB balance below zero: not carried over (debt is forgiven)
  | 'excluded' // in the exclude list, or flagged as a bot by Discord
  | 'invalid' // non-finite (Infinity) or larger than the PEP Int column allows

export interface PlanEntry {
  discordId: string
  memberId: string | null
  status: EntryStatus
  reason: string
  cash: string
  bank: string
  total: string
  /** UB units converted (per `basis`). */
  sourceAmount: string
  /** PEP to credit; 0 unless status is credit or pending. */
  amount: number
  migrationKey: string
}

export interface MigrationPlan {
  guildId: string
  rate: string
  basis: Basis
  entries: PlanEntry[]
  summary: {
    users: number
    byStatus: Record<EntryStatus, number>
    ubTotals: Snapshot['totals']
    /** UB units (per basis) that will be converted for credit + pending. */
    sourceMigrated: string
    pepToCredit: number
    pepToHold: number
    pepTotal: number
    /** Sum of negative UB balances that are being forgiven. */
    negativeForgiven: string
    /** Whole PEP lost in aggregate to per-user floor rounding. */
    roundingLossPep: string
  }
}

export function migrationKey(guildId: string, discordId: string): string {
  return `${MIGRATION_SOURCE}:${guildId}:${discordId}`
}

/** Parse a non-negative decimal rate into an exact fraction num/den. */
export function parseRate(rate: string): { num: bigint; den: bigint } {
  const s = rate.trim()
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s)
  if (!m) throw new Error(`invalid rate "${rate}" (expected e.g. 1, 0.01, 2.5)`)
  const frac = m[2] ?? ''
  const den = BigInt('1' + '0'.repeat(frac.length))
  const num = BigInt(m[1] + frac)
  if (num === BigInt(0)) throw new Error('rate must be greater than 0')
  return { num, den }
}

function basisAmount(u: SnapshotUser, basis: Basis): string {
  return basis === 'cash' ? u.cash : basis === 'bank' ? u.bank : u.total
}

/**
 * @param knownMembers discordId -> memberId (null when the user has an app
 *   account/User row but no sheet member ID). Anyone absent is "not onboarded".
 */
export function buildMigrationPlan(
  snapshot: Snapshot,
  knownMembers: Map<string, string | null>,
  opts: PlanOptions = {},
): MigrationPlan {
  const rateStr = opts.rate ?? '1'
  const { num, den } = parseRate(rateStr)
  const basis = opts.basis ?? 'total'
  const exclude = new Set(opts.exclude ?? [])
  const minAmount = opts.minAmount ?? 1
  const zero = BigInt(0)

  const byStatus: Record<EntryStatus, number> = { credit: 0, pending: 0, zero: 0, negative: 0, excluded: 0, invalid: 0 }
  let sourceMigrated = zero
  let negativeForgiven = zero
  let roundingRemainder = zero
  let pepToCredit = 0
  let pepToHold = 0

  const entries: PlanEntry[] = snapshot.users.map((u) => {
    const src = basisAmount(u, basis)
    const base = {
      discordId: u.discordId,
      memberId: knownMembers.get(u.discordId) ?? null,
      cash: u.cash,
      bank: u.bank,
      total: u.total,
      sourceAmount: src,
      amount: 0,
      migrationKey: migrationKey(snapshot.guildId, u.discordId),
    }
    const done = (status: EntryStatus, reason: string, amount = 0): PlanEntry => {
      byStatus[status]++
      return { ...base, status, reason, amount }
    }

    if (exclude.has(u.discordId)) return done('excluded', 'in exclude list')
    if (u.bot === true) return done('excluded', 'Discord bot account')
    if (!isFiniteAmount(src)) return done('invalid', `non-finite UB ${basis} (${src}); decide manually`)

    const v = BigInt(src)
    if (v < zero) {
      negativeForgiven += v
      return done('negative', `UB ${basis} is ${src}; negative balances are not carried over`)
    }
    const converted = (v * num) / den
    roundingRemainder += (v * num) % den
    if (converted < BigInt(minAmount)) return done('zero', v === zero ? 'zero balance' : `converts to ${converted} PEP (< ${minAmount})`)
    if (converted > BigInt(PEP_INT_MAX)) {
      return done('invalid', `converts to ${converted} PEP, above the Int max ${PEP_INT_MAX}; lower the rate or cap`)
    }

    const amount = Number(converted)
    sourceMigrated += v
    if (knownMembers.has(u.discordId)) {
      pepToCredit += amount
      return done('credit', base.memberId ? `member ${base.memberId}` : 'has app account', amount)
    }
    pepToHold += amount
    return done('pending', u.inGuild === false ? 'not a member; left the Discord server' : 'not a member yet; held until first login', amount)
  })

  return {
    guildId: snapshot.guildId,
    rate: rateStr,
    basis,
    entries,
    summary: {
      users: entries.length,
      byStatus,
      ubTotals: snapshot.totals,
      sourceMigrated: sourceMigrated.toString(),
      pepToCredit,
      pepToHold,
      pepTotal: pepToCredit + pepToHold,
      negativeForgiven: negativeForgiven.toString(),
      roundingLossPep: (roundingRemainder / den).toString(),
    },
  }
}

/** Human-readable dry-run report. */
export function formatPlanReport(plan: MigrationPlan, opts: { showAll?: boolean; limit?: number } = {}): string {
  const s = plan.summary
  const lines: string[] = []
  lines.push(`UnbelievaBoat -> $PEP migration plan (guild ${plan.guildId})`)
  lines.push(`  rate: 1 UB ${plan.basis} = ${plan.rate} PEP (rounded down per user)`)
  lines.push(`  UB users: ${s.users}   UB cash: ${s.ubTotals.cash}   bank: ${s.ubTotals.bank}   total: ${s.ubTotals.total}`)
  lines.push('')
  lines.push(`  matched (credit now):     ${String(s.byStatus.credit).padStart(6)} users  ${s.pepToCredit} PEP`)
  lines.push(`  unmatched (pending claim):${String(s.byStatus.pending).padStart(6)} users  ${s.pepToHold} PEP`)
  lines.push(`  zero / dust:              ${String(s.byStatus.zero).padStart(6)} users`)
  lines.push(`  negative (forgiven):      ${String(s.byStatus.negative).padStart(6)} users  ${s.negativeForgiven} UB`)
  lines.push(`  excluded (bots/list):     ${String(s.byStatus.excluded).padStart(6)} users`)
  lines.push(`  invalid (needs decision): ${String(s.byStatus.invalid).padStart(6)} users`)
  lines.push(`  PEP total to mint:        ${s.pepTotal}   (lost to rounding: ~${s.roundingLossPep} PEP)`)

  const groups: EntryStatus[] = ['invalid', 'negative', 'excluded', 'pending', 'credit']
  const limit = opts.showAll ? Infinity : opts.limit ?? 25
  for (const g of groups) {
    const rows = plan.entries.filter((e) => e.status === g)
    if (!rows.length) continue
    lines.push('')
    lines.push(`  -- ${g} (${rows.length}) --`)
    for (const e of rows.slice(0, limit)) {
      lines.push(
        `  ${e.discordId.padEnd(20)} ${(e.memberId ?? '-').padEnd(8)} cash=${e.cash} bank=${e.bank} -> ${e.amount} PEP  ${e.reason}`,
      )
    }
    if (rows.length > limit) lines.push(`  ... ${rows.length - limit} more (use --show-all or the CSV report)`)
  }
  return lines.join('\n')
}

/** Per-user plan as CSV (written next to the snapshot for audit). */
export function planToCsv(plan: MigrationPlan): string {
  const head = 'discord_id,member_id,status,ub_cash,ub_bank,ub_total,source_amount,pep_amount,migration_key,reason'
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const rows = plan.entries.map((e) =>
    [e.discordId, e.memberId ?? '', e.status, e.cash, e.bank, e.total, e.sourceAmount, String(e.amount), e.migrationKey, e.reason]
      .map(esc)
      .join(','),
  )
  return [head, ...rows].join('\n') + '\n'
}
