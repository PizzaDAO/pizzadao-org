/**
 * Before/after reconciliation for the UnbelievaBoat import. Pure.
 *
 * For each plan entry: wallet before the run, wallet after, the expected
 * delta (the claim amount if it was credited during this run) and whether
 * the observed delta matches. Concurrent app activity (a transfer during the
 * import) shows up as a mismatch to investigate, which is why the cutover
 * runs during the announced freeze.
 */
import type { MigrationPlan } from './plan'

export interface ClaimState {
  status: string
  amount: number
  creditedAt: Date | null
  transactionId: number | null
}

export interface DiffRow {
  discordId: string
  memberId: string | null
  planStatus: string
  claimStatus: string
  expectedDelta: number
  before: number
  after: number
  actualDelta: number
  ok: boolean
}

export interface ReconcileReport {
  rows: DiffRow[]
  totals: {
    expectedDelta: number
    actualDelta: number
    walletsBefore: number
    walletsAfter: number
    claimsCredited: number
    claimsPending: number
    pepPending: number
    mismatches: number
  }
}

export function reconcile(
  plan: MigrationPlan,
  before: Map<string, number>,
  after: Map<string, number>,
  claims: Map<string, ClaimState>,
  /** Claims credited by this run (from creditMatched). Others count as pre-existing. */
  creditedThisRun: Set<string>,
): ReconcileReport {
  const rows: DiffRow[] = []
  const t = { expectedDelta: 0, actualDelta: 0, walletsBefore: 0, walletsAfter: 0, claimsCredited: 0, claimsPending: 0, pepPending: 0, mismatches: 0 }
  for (const e of plan.entries) {
    const claim = claims.get(e.migrationKey)
    const b = before.get(e.discordId) ?? 0
    const a = after.get(e.discordId) ?? 0
    const expectedDelta = creditedThisRun.has(e.migrationKey) ? claim?.amount ?? e.amount : 0
    const actualDelta = a - b
    const ok = expectedDelta === actualDelta
    rows.push({
      discordId: e.discordId,
      memberId: e.memberId,
      planStatus: e.status,
      claimStatus: claim?.status ?? '-',
      expectedDelta,
      before: b,
      after: a,
      actualDelta,
      ok,
    })
    t.expectedDelta += expectedDelta
    t.actualDelta += actualDelta
    t.walletsBefore += b
    t.walletsAfter += a
    if (claim?.status === 'CREDITED') t.claimsCredited++
    if (claim?.status === 'PENDING') {
      t.claimsPending++
      t.pepPending += claim.amount
    }
    if (!ok) t.mismatches++
  }
  return { rows, totals: t }
}

export function reconcileToCsv(r: ReconcileReport): string {
  const head = 'discord_id,member_id,plan_status,claim_status,expected_delta,wallet_before,wallet_after,actual_delta,ok'
  const lines = r.rows.map((x) =>
    [x.discordId, x.memberId ?? '', x.planStatus, x.claimStatus, x.expectedDelta, x.before, x.after, x.actualDelta, x.ok].join(','),
  )
  return [head, ...lines].join('\n') + '\n'
}
