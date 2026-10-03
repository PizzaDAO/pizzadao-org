/**
 * The mission verification engine (plans/mission-verification.md §3.3).
 *
 * runVerifiers(discordId) checks every active mission that has an automatic
 * verifier and turns passes into completions, idempotently:
 *
 *   no row / PENDING (no hold)  pass -> APPROVED, reviewedBy "auto:<key>", source AUTO,
 *                               or PENDING + holdReason when D9 needs a human
 *                               release (L6+, or a Discord account < 30 days old)
 *   PENDING, NEW_ACCOUNT hold   re-checked; approved once the account is 30 days old
 *   PENDING, other holds        left for the human release
 *   APPROVED                    no-op; stateful verifiers (roles) re-check and
 *                               FLAG / unflag, never claw back (D17)
 *   REJECTED by a human         never overridden: if the verifier now passes the
 *                               row goes back to PENDING (hold PREVIOUSLY_REJECTED)
 *                               for a human to decide again, once
 *
 * Every write is a conditional update (or a create guarded by the
 * @@unique([missionId, discordId]) key), and its MissionReviewEvent is written
 * in the same transaction by the winner only. Then settleLevels() pays every
 * complete level in order through the race-safe checkAndAwardLevelReward, so
 * parallel runs for the same member pay each level exactly once.
 *
 * Behind MISSION_VERIFIERS_ENABLED (default off): when off, every run is a
 * dry run that only reports progress.
 */
import { Prisma, type MissionHold } from '@prisma/client'
import { prisma } from '../db'
import { createNotification } from '../notifications'
import { notifyReviewers, recordReviewEvent, rejectionSnapshot, settleLevels } from '../missions'
import { queueReviewCardSync, reviewCardsEnabled, syncReviewCardsFor } from './review-cards'
import { NEW_REVIEW_ROUND } from './review-ids'
import { invalidateProgressCache } from '../mission-cache'
import { fetchMemberIdByDiscordId } from '../sheets/member-repository'
import { getVerifier } from './verifiers'
import { defaultSources } from './sources'
import { HOLD_LABEL, missionVerifiersEnabled, releaseHoldFor } from './policy'
import type { Trigger, VerifierSources, VerifyCtx, VerifyResult } from './types'

export interface RunOptions {
  trigger: Trigger
  /** Only these missions (e.g. the one just submitted). Default: every active mission with a verifier. */
  missionIds?: number[]
  /** Only missions using these verifiers (event hooks). */
  verifierKeys?: string[]
  /** Known memberId; `null` = none. Omitted: resolved from the members sheet. */
  memberId?: string | null
  /** Roles from a Discord interaction payload (fresh and free). */
  interactionRoles?: string[]
  /** Report only, write nothing. Forced on while MISSION_VERIFIERS_ENABLED is off. */
  dryRun?: boolean
  now?: Date
  sources?: VerifierSources
  /** Override the flag (tests). */
  enabled?: boolean
  /**
   * The active missions with a verifier, already loaded (bulk runs load them
   * once per batch instead of once per member). Filtered like the query below.
   */
  missions?: MissionRow[]
}

export type CheckOutcome =
  | 'approved' //       this run approved it
  | 'held' //           this run held it for a human release
  | 'reopened' //       a human rejection went back to review
  | 'would_approve' //  dry run
  | 'would_hold' //     dry run
  | 'already_approved'
  | 'awaiting_release'
  | 'pending_review'
  | 'rejected'
  | 'not_yet'

export interface MissionCheck {
  missionId: number
  level: number
  index: number
  title: string
  verifierKey: string
  result: VerifyResult | { status: 'skipped'; reason: string }
  outcome: CheckOutcome
  holdReason?: MissionHold | null
}

export interface RunReport {
  discordId: string
  enabled: boolean
  dryRun: boolean
  trigger: Trigger
  checks: MissionCheck[]
  approved: number[]
  held: number[]
  reopened: number[]
  flagged: number[]
  unflagged: number[]
  /** Dry runs: APPROVED rows a stateful re-check would flag / unflag. */
  wouldFlag: number[]
  wouldUnflag: number[]
  levelsPaid: number[]
  errors: string[]
}

type Row = {
  id: number
  missionId: number
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  source: 'MANUAL' | 'AUTO' | 'SEMI'
  holdReason: MissionHold | null
  evidence: string | null
  reviewedBy: string | null
  reviewNote: string | null
  reviewedAt: Date | null
  flaggedAt: Date | null
  attempts: number
  notes: string | null
}

const ROW_SELECT = {
  id: true,
  missionId: true,
  status: true,
  source: true,
  holdReason: true,
  evidence: true,
  reviewedBy: true,
  reviewNote: true,
  reviewedAt: true,
  flaggedAt: true,
  attempts: true,
  notes: true,
} as const

export type MissionRow = {
  id: number
  level: number
  index: number
  title: string
  verifierKey: string | null
  verifierParams: Prisma.JsonValue | null
}

const isP2002 = (e: unknown) => (e as { code?: string })?.code === 'P2002'
const json = (v: unknown) => JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue

export async function runVerifiers(discordId: string, opts: RunOptions): Promise<RunReport> {
  const enabled = opts.enabled ?? missionVerifiersEnabled()
  const dryRun = !enabled || !!opts.dryRun
  const now = opts.now ?? new Date()
  const report: RunReport = {
    discordId,
    enabled,
    dryRun,
    trigger: opts.trigger,
    checks: [],
    approved: [],
    held: [],
    reopened: [],
    flagged: [],
    unflagged: [],
    wouldFlag: [],
    wouldUnflag: [],
    levelsPaid: [],
    errors: [],
  }

  const missions: MissionRow[] = opts.missions
    ? opts.missions.filter(
        (m) =>
          m.verifierKey != null &&
          (!opts.verifierKeys || opts.verifierKeys.includes(m.verifierKey)) &&
          (!opts.missionIds || opts.missionIds.includes(m.id)),
      )
    : await prisma.mission.findMany({
        where: {
          isActive: true,
          verifierKey: opts.verifierKeys ? { in: opts.verifierKeys } : { not: null },
          ...(opts.missionIds ? { id: { in: opts.missionIds } } : {}),
        },
        select: { id: true, level: true, index: true, title: true, verifierKey: true, verifierParams: true },
        orderBy: [{ level: 'asc' }, { index: 'asc' }],
      })
  const runnable = missions.filter((m) => getVerifier(m.verifierKey)?.mode === 'auto')
  if (runnable.length === 0) return report

  const rows: Row[] = await prisma.missionCompletion.findMany({
    where: { discordId, missionId: { in: runnable.map((m) => m.id) } },
    select: ROW_SELECT,
  })
  const byMission = new Map(rows.map((r) => [r.missionId, r]))

  const memberId =
    opts.memberId !== undefined ? opts.memberId : await fetchMemberIdByDiscordId(discordId).catch(() => null)
  const memo = new Map<string, unknown>()
  const ctxFor = (row: Row | undefined): VerifyCtx => ({
    discordId,
    memberId,
    trigger: opts.trigger,
    now,
    interactionRoles: opts.interactionRoles,
    evidence: row?.evidence ?? null,
    sources: opts.sources ?? defaultSources,
    memo,
  })

  for (const m of runnable) {
    const v = getVerifier(m.verifierKey)!
    const base = { missionId: m.id, level: m.level, index: m.index, title: m.title, verifierKey: m.verifierKey! }
    let params: unknown
    try {
      params = v.parse(m.verifierParams)
    } catch (e) {
      const reason = `bad verifierParams: ${e instanceof Error ? e.message : String(e)}`
      report.errors.push(`mission ${m.id}: ${reason}`)
      report.checks.push({ ...base, result: { status: 'skipped', reason }, outcome: 'not_yet' })
      continue
    }

    const row = byMission.get(m.id)
    const check = async (): Promise<VerifyResult> => {
      try {
        return await v.check(ctxFor(row), params)
      } catch (e) {
        report.errors.push(`mission ${m.id}: ${e instanceof Error ? e.message : String(e)}`)
        return { status: 'unknown', reason: 'Check failed' }
      }
    }

    // ---- APPROVED: idempotent no-op, except flagging for stateful verifiers.
    if (row?.status === 'APPROVED') {
      if (!v.stateful) {
        report.checks.push({ ...base, result: { status: 'skipped', reason: 'Already approved' }, outcome: 'already_approved' })
        continue
      }
      const r = await check()
      report.checks.push({ ...base, result: r, outcome: 'already_approved' })
      if (!dryRun) await maybeFlag(row, r, m, report, opts.trigger)
      else if (r.status === 'fail' && !row.flaggedAt) report.wouldFlag.push(m.id)
      else if (r.status === 'pass' && row.flaggedAt) report.wouldUnflag.push(m.id)
      continue
    }

    // ---- REJECTED: a human said no. Never approve; reopen for review once.
    if (row?.status === 'REJECTED') {
      if (row.source !== 'MANUAL') {
        // Already reopened (or rejected despite a verifier pass): the human decision stands.
        report.checks.push({ ...base, result: { status: 'skipped', reason: 'Rejected by a reviewer' }, outcome: 'rejected' })
        continue
      }
      const r = await check()
      if (r.status !== 'pass' || dryRun) {
        report.checks.push({ ...base, result: r, outcome: 'rejected' })
        continue
      }
      const ok = await reopen(row, m, v.key, r.evidence, opts.trigger)
      if (ok) report.reopened.push(m.id)
      report.checks.push({ ...base, result: r, outcome: ok ? 'reopened' : 'rejected', holdReason: ok ? 'PREVIOUSLY_REJECTED' : null })
      continue
    }

    // ---- PENDING with a hold: waits for a human, except NEW_ACCOUNT once the account is old enough.
    if (row?.status === 'PENDING' && row.holdReason) {
      const liftable = row.holdReason === 'NEW_ACCOUNT' && releaseHoldFor(m.level, discordId, now) === null
      if (!liftable) {
        report.checks.push({
          ...base,
          result: { status: 'skipped', reason: HOLD_LABEL[row.holdReason] },
          outcome: 'awaiting_release',
          holdReason: row.holdReason,
        })
        continue
      }
    }

    // ---- no row, plain PENDING, or a liftable NEW_ACCOUNT hold: run the check.
    const r = await check()
    if (r.status !== 'pass') {
      report.checks.push({ ...base, result: r, outcome: row?.status === 'PENDING' ? 'pending_review' : 'not_yet', holdReason: row?.holdReason ?? null })
      continue
    }
    const hold = releaseHoldFor(m.level, discordId, now)
    if (dryRun) {
      report.checks.push({ ...base, result: r, outcome: hold ? 'would_hold' : 'would_approve', holdReason: hold })
      continue
    }

    const outcome = await applyPass(row, m, discordId, memberId, v.key, r.evidence, hold, opts.trigger)
    if (outcome === 'approved') report.approved.push(m.id)
    if (outcome === 'held') report.held.push(m.id)
    report.checks.push({ ...base, result: r, outcome, holdReason: outcome === 'held' ? hold : null })
  }

  if (!dryRun) {
    report.levelsPaid = await settleLevels(discordId)
    if (report.approved.length || report.held.length || report.reopened.length || report.levelsPaid.length) {
      invalidateProgressCache(discordId)
    }
    notifyInApp(discordId, report)
    // Discord review cards (Phase 3): post one for a new hold / reopen, and
    // update an existing card the verifier just approved or held.
    const cardMissions = report.checks
      .filter((c) => c.outcome === 'approved' || c.outcome === 'held' || c.outcome === 'reopened')
      .map((c) => c.missionId)
    if (cardMissions.length && reviewCardsEnabled()) queueReviewCardSync(() => syncReviewCardsFor(discordId, cardMissions))
  }
  return report
}

/**
 * Apply a verifier pass: create the completion, or move a PENDING one. The
 * create is guarded by the unique key; on a lost race the row that won is
 * re-read and handled once more as a PENDING row.
 */
async function applyPass(
  row: Row | undefined,
  m: MissionRow,
  discordId: string,
  memberId: string | null,
  key: string,
  evidence: Record<string, unknown>,
  hold: MissionHold | null,
  via: Trigger,
): Promise<CheckOutcome> {
  const actor = `auto:${key}`
  const decided = hold
    ? { status: 'PENDING' as const, holdReason: hold, reviewedBy: null, reviewedAt: null }
    : { status: 'APPROVED' as const, holdReason: null, reviewedBy: actor, reviewedAt: new Date() }
  const event = {
    actorId: actor,
    action: hold ? ('AUTO_HELD' as const) : ('AUTO_APPROVED' as const),
    via,
    note: hold ? HOLD_LABEL[hold] : null,
    metadata: json({ evidence, ...(hold ? { holdReason: hold } : {}) }),
  }

  if (!row) {
    try {
      await prisma.$transaction(async (tx) => {
        const c = await tx.missionCompletion.create({
          data: {
            missionId: m.id,
            discordId,
            memberId,
            source: 'AUTO',
            checkResult: json(evidence),
            ...decided,
            ...(hold ? { reviewQueuedAt: new Date() } : {}),
          },
          select: { id: true },
        })
        await recordReviewEvent(tx, { completionId: c.id, ...event })
      })
      return hold ? 'held' : 'approved'
    } catch (e) {
      if (!isP2002(e)) throw e
      // Someone else (a concurrent run, or the member submitting) created it first.
      const fresh = await prisma.missionCompletion.findUnique({
        where: { missionId_discordId: { missionId: m.id, discordId } },
        select: ROW_SELECT,
      })
      if (!fresh) return 'not_yet'
      if (fresh.status === 'APPROVED') return 'already_approved'
      if (fresh.status === 'REJECTED') return 'rejected'
      if (fresh.holdReason && fresh.holdReason !== 'NEW_ACCOUNT') return 'awaiting_release'
      row = fresh
    }
  }

  // Already held (e.g. a concurrent run held it first): stays held, nothing to write.
  if (hold && row.holdReason) return 'awaiting_release'

  // PENDING -> APPROVED / held, conditional on the row still being in the state we read.
  const won = await prisma.$transaction(async (tx) => {
    const u = await tx.missionCompletion.updateMany({
      where: { id: row!.id, status: 'PENDING', holdReason: row!.holdReason ?? null },
      data: { source: 'AUTO', checkResult: json(evidence), ...decided },
    })
    if (u.count !== 1) return false
    await recordReviewEvent(tx, { completionId: row!.id, ...event })
    return true
  })
  if (won) return hold ? 'held' : 'approved'
  if (hold && row.holdReason === hold) return 'awaiting_release'
  return 'pending_review'
}

/** REJECTED (by a human, MANUAL) -> PENDING with a PREVIOUSLY_REJECTED hold. Once. */
async function reopen(row: Row, m: MissionRow, key: string, evidence: Record<string, unknown>, via: Trigger): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const u = await tx.missionCompletion.updateMany({
      where: { id: row.id, status: 'REJECTED', source: 'MANUAL' },
      data: {
        status: 'PENDING',
        source: 'AUTO',
        holdReason: 'PREVIOUSLY_REJECTED',
        checkResult: json(evidence),
        reviewedBy: null,
        reviewNote: null,
        reviewedAt: null,
        ...NEW_REVIEW_ROUND(),
      },
    })
    if (u.count !== 1) return false
    await recordReviewEvent(tx, {
      completionId: row.id,
      actorId: `auto:${key}`,
      action: 'REOPENED',
      via,
      note: 'A reviewer rejected this before; the verifier now passes. A reviewer decides again.',
      metadata: json({ evidence, previous: rejectionSnapshot(row.attempts, row), mission: { level: m.level, index: m.index } }),
    })
    return true
  })
}

/** Stateful re-check of an APPROVED row: flag when the state is gone, unflag when it is back. Never revokes. */
async function maybeFlag(row: Row, r: VerifyResult, m: MissionRow, report: RunReport, via: Trigger) {
  const actor = `auto:${m.verifierKey}`
  if (r.status === 'fail' && !row.flaggedAt) {
    const done = await prisma.$transaction(async (tx) => {
      const u = await tx.missionCompletion.updateMany({
        where: { id: row.id, status: 'APPROVED', flaggedAt: null },
        data: { flaggedAt: new Date(), flagReason: r.reason.slice(0, 300) },
      })
      if (u.count !== 1) return false
      await recordReviewEvent(tx, { completionId: row.id, actorId: actor, action: 'FLAGGED', via, note: r.reason })
      return true
    })
    if (done) report.flagged.push(m.id)
  } else if (r.status === 'pass' && row.flaggedAt) {
    const done = await prisma.$transaction(async (tx) => {
      const u = await tx.missionCompletion.updateMany({
        where: { id: row.id, status: 'APPROVED', flaggedAt: { not: null } },
        data: { flaggedAt: null, flagReason: null },
      })
      if (u.count !== 1) return false
      await recordReviewEvent(tx, { completionId: row.id, actorId: actor, action: 'UNFLAGGED', via })
      return true
    })
    if (done) report.unflagged.push(m.id)
  }
}

/** In-app notifications (DB only). Discord DMs and #work posts: ./notify.ts. */
function notifyInApp(discordId: string, report: RunReport) {
  for (const c of report.checks) {
    if (c.outcome === 'approved') {
      createNotification({
        type: 'MISSION_APPROVED',
        recipientId: discordId,
        actorId: `auto:${c.verifierKey}`,
        title: 'Mission Verified!',
        message: `"${c.title.slice(0, 60)}" was verified automatically.`,
        metadata: { missionId: c.missionId, auto: true },
        linkUrl: '/missions',
      }).catch(() => {})
    }
    if (c.outcome === 'held' || c.outcome === 'reopened') {
      const why = c.holdReason ? HOLD_LABEL[c.holdReason] : 'needs a reviewer'
      notifyReviewers(discordId, c.title, c.level, `"${c.title.slice(0, 50)}" was auto-verified and awaits your release (${why}).`).catch(
        () => {},
      )
    }
  }
}
