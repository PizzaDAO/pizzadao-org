/**
 * Batched, time-boxed, resumable runs over many members, recorded on a
 * VerifierRun row (plans/mission-verification.md §3.4, §7).
 *
 *   - Members are processed in numeric discordId order; after every batch the
 *     run's `cursor` (the last discordId done) and `stats` are saved, so an
 *     invocation that runs out of time (or crashes) is resumed by the next
 *     one from the cursor.
 *   - A lease (`leaseUntil`) keeps two invocations from working the same run
 *     at once. Correctness never depends on it (every write is idempotent and
 *     every payout exactly-once), it only avoids wasted work.
 *   - The time box stops before a batch that would not fit in the budget.
 *
 * The storage and the per-batch work are injected, so this is unit tested
 * without a database.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../db'
import type { MemberOutcome } from './bulk'

export type RunKind = 'nightly' | 'backfill'

export interface RunStats {
  /** Members checked. */
  members: number
  approved: number
  held: number
  reopened: number
  flagged: number
  unflagged: number
  /** Live runs: levels paid (level -> count) and the PEP paid. */
  levelsPaid: Record<string, number>
  pepPaid: number
  /** Dry runs: what a live run would have done. */
  wouldApprove: number
  wouldHold: number
  wouldReopen: number
  wouldFlag: number
  wouldUnflag: number
  wouldPayLevels: Record<string, number>
  wouldPayPep: number
  /** Members whose run threw, plus per-mission errors (bad params, upstream). */
  errors: number
  errorSamples: string[]
  invocations: number
  /** Wall time spent across invocations. */
  durationMs: number
  /** Anything else the caller records (e.g. confirmedTotal, signals). */
  [extra: string]: unknown
}

export function emptyStats(): RunStats {
  return {
    members: 0,
    approved: 0,
    held: 0,
    reopened: 0,
    flagged: 0,
    unflagged: 0,
    levelsPaid: {},
    pepPaid: 0,
    wouldApprove: 0,
    wouldHold: 0,
    wouldReopen: 0,
    wouldFlag: 0,
    wouldUnflag: 0,
    wouldPayLevels: {},
    wouldPayPep: 0,
    errors: 0,
    errorSamples: [],
    invocations: 0,
    durationMs: 0,
  }
}

const MAX_ERROR_SAMPLES = 20

/** Fold one member's outcome into the run stats. */
export function addOutcome(stats: RunStats, o: MemberOutcome): RunStats {
  stats.members++
  const sample = (msg: string) => {
    stats.errors++
    if (stats.errorSamples.length < MAX_ERROR_SAMPLES) stats.errorSamples.push(`${o.discordId}: ${msg}`.slice(0, 300))
  }
  if (o.error) sample(o.error)
  const r = o.report
  if (!r) return stats
  for (const e of r.errors) sample(e)
  if (r.dryRun) {
    for (const c of r.checks) {
      if (c.outcome === 'would_approve') stats.wouldApprove++
      if (c.outcome === 'would_hold') stats.wouldHold++
      if (c.outcome === 'rejected' && c.result.status === 'pass') stats.wouldReopen++
    }
    stats.wouldFlag += r.wouldFlag.length
    stats.wouldUnflag += r.wouldUnflag.length
    for (const p of o.payouts) {
      stats.wouldPayLevels[p.level] = (stats.wouldPayLevels[p.level] ?? 0) + 1
      stats.wouldPayPep += p.reward
    }
  } else {
    stats.approved += r.approved.length
    stats.held += r.held.length
    stats.reopened += r.reopened.length
    stats.flagged += r.flagged.length
    stats.unflagged += r.unflagged.length
    for (const p of o.payouts) {
      stats.levelsPaid[p.level] = (stats.levelsPaid[p.level] ?? 0) + 1
      stats.pepPaid += p.reward
    }
  }
  return stats
}

export interface RunRow {
  id: number
  kind: string
  dryRun: boolean
  startedAt: Date
  finishedAt: Date | null
  cursor: string | null
  leaseUntil: Date | null
  stats: RunStats
}

export interface RunStore {
  /** The newest unfinished run of this kind (and dry-run mode) started after `since`. */
  findOpen(kind: RunKind, since: Date, dryRun?: boolean): Promise<RunRow | null>
  /** The newest run of this kind, finished or not. */
  latest(kind: RunKind): Promise<RunRow | null>
  create(kind: RunKind, dryRun: boolean, stats: RunStats): Promise<RunRow>
  /** Take the lease if it is free (or expired). False = another invocation holds it. */
  claim(id: number, until: Date, now: Date): Promise<boolean>
  save(id: number, patch: { cursor?: string | null; stats?: RunStats; finishedAt?: Date | null; leaseUntil?: Date | null }): Promise<void>
}

const toRow = (r: {
  id: number
  kind: string
  dryRun: boolean
  startedAt: Date
  finishedAt: Date | null
  cursor: string | null
  leaseUntil: Date | null
  stats: Prisma.JsonValue | null
}): RunRow => ({ ...r, stats: { ...emptyStats(), ...((r.stats as object | null) ?? {}) } as RunStats })

export const prismaRunStore: RunStore = {
  async findOpen(kind, since, dryRun) {
    const r = await prisma.verifierRun.findFirst({
      where: { kind, finishedAt: null, startedAt: { gte: since }, ...(dryRun !== undefined ? { dryRun } : {}) },
      orderBy: { startedAt: 'desc' },
    })
    return r ? toRow(r) : null
  },
  async latest(kind) {
    const r = await prisma.verifierRun.findFirst({ where: { kind }, orderBy: { startedAt: 'desc' } })
    return r ? toRow(r) : null
  },
  async create(kind, dryRun, stats) {
    return toRow(await prisma.verifierRun.create({ data: { kind, dryRun, stats: stats as Prisma.InputJsonValue } }))
  },
  async claim(id, until, now) {
    const u = await prisma.verifierRun.updateMany({
      where: { id, finishedAt: null, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      data: { leaseUntil: until },
    })
    return u.count === 1
  },
  async save(id, patch) {
    await prisma.verifierRun.update({
      where: { id },
      data: {
        ...(patch.cursor !== undefined ? { cursor: patch.cursor } : {}),
        ...(patch.stats ? { stats: patch.stats as Prisma.InputJsonValue } : {}),
        ...(patch.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {}),
        ...(patch.leaseUntil !== undefined ? { leaseUntil: patch.leaseUntil } : {}),
      },
    })
  },
}

export interface DriveOptions {
  run: RunRow
  store: RunStore
  /** Every member to process, in compareDiscordIds order, AFTER the run's cursor. */
  members: string[]
  processBatch: (ids: string[]) => Promise<MemberOutcome[]>
  batchSize: number
  /** Wall-clock budget for this invocation, in ms (Infinity for scripts). */
  budgetMs: number
  clock?: () => number
  /** Called after every batch (progress output, payout caps). Return false to stop. */
  onBatch?: (outcomes: MemberOutcome[], stats: RunStats) => boolean | void | Promise<boolean | void>
}

export interface DriveResult {
  run: RunRow
  /** True when every member was processed (the run is finished). */
  done: boolean
  /** True when onBatch asked to stop. */
  stopped: boolean
  processed: number
  outcomes: MemberOutcome[]
}

/**
 * Process `members` in batches until done, out of budget, or stopped; the
 * cursor and stats are saved after every batch and the lease released at the
 * end. The caller has already claimed the lease.
 */
export async function driveRun(o: DriveOptions): Promise<DriveResult> {
  const clock = o.clock ?? Date.now
  const started = clock()
  const stats = o.run.stats
  stats.invocations++
  let cursor = o.run.cursor
  let processed = 0
  let slowest = 0
  let stopped = false
  const outcomes: MemberOutcome[] = []

  try {
    for (let i = 0; i < o.members.length; i += o.batchSize) {
      const elapsed = clock() - started
      // Stop before a batch that probably won't fit (allow 1.5x the slowest so far).
      if (processed > 0 && elapsed + slowest * 1.5 > o.budgetMs) break
      if (processed === 0 && o.budgetMs <= 0) break
      const ids = o.members.slice(i, i + o.batchSize)
      const t0 = clock()
      const batch = await o.processBatch(ids)
      slowest = Math.max(slowest, clock() - t0)
      for (const b of batch) addOutcome(stats, b)
      outcomes.push(...batch)
      processed += ids.length
      cursor = ids[ids.length - 1]
      stats.durationMs += clock() - t0
      await o.store.save(o.run.id, { cursor, stats })
      if ((await o.onBatch?.(batch, stats)) === false) {
        stopped = true
        break
      }
    }
  } finally {
    const done = !stopped && processed >= o.members.length
    await o.store.save(o.run.id, { cursor, stats, leaseUntil: null, ...(done ? { finishedAt: new Date(clock()) } : {}) })
  }
  const done = !stopped && processed >= o.members.length
  return { run: { ...o.run, cursor, stats, finishedAt: done ? new Date(clock()) : null }, done, stopped, processed, outcomes }
}
