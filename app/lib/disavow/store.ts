/**
 * Disavow list mutations. Rules (plans/disavow-list.md):
 *  - nothing is ever deleted: status changes and redaction only;
 *  - every mutation runs in one transaction and appends a DisavowEvent;
 *  - a round is counted inside a transaction that locks its row, reading fresh
 *    votes, and closing is guarded by `state = OPEN`, so concurrent votes,
 *    views and cron runs can't double-settle or slip a vote in after the count;
 *  - at most one OPEN round per disavowal (partial unique index);
 *  - notifications carry no names or content and are best-effort.
 */
import { prisma } from '@/app/lib/db'
import { createNotification } from '@/app/lib/notifications'
import { getMembersWithRoles } from '@/app/lib/discord'
import { DREAD_PIZZA_ROBERTS_ROLE_ID } from '@/app/ui/constants'
import {
  DAY_MS, DISAVOW_APPEAL_COOLDOWN_DAYS, DISAVOW_LISTING_MONTHS, DISAVOW_NOMINATIONS_PER_WINDOW,
  DISAVOW_NOMINATION_WINDOW_DAYS, DISAVOW_WINDOW_DAYS, REDACTED,
} from './constants'
import type { IdentifierInput } from './identity'
import { discordIdsForIdentifiers, identifierOr, viewerIdentifiers } from './match'
import { tallyRound, windowEnd, type TallyVote } from './tally'

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
type Reason = 'SCAM' | 'THEFT_OF_FUNDS' | 'NON_DELIVERY' | 'IMPERSONATION' | 'HARASSMENT' | 'OTHER'

const ACTIVE_STATUSES = ['NOMINATED', 'LISTED', 'SUSPENDED'] as const

function addMonths(d: Date, months: number): Date {
  const out = new Date(d.getTime())
  out.setUTCMonth(out.getUTCMonth() + months)
  return out
}

function logEvent(tx: Tx, disavowalId: string, type: string, actorDiscordId: string | null, data?: Record<string, unknown>) {
  return tx.disavowEvent.create({
    data: { disavowalId, type: type as never, actorDiscordId, data: (data ?? undefined) as never },
  })
}

/** Row lock so a vote and a settle on the same round serialize. */
function lockRound(tx: Tx, roundId: string) {
  return tx.$queryRaw`SELECT id FROM "DisavowRound" WHERE id = ${roundId} FOR UPDATE`
}

const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === 'P2002'

async function notify(
  type: 'DISAVOW_VOTE_NEEDED' | 'DISAVOW_ROUND_CLOSED' | 'DISAVOW_LISTED_SUBJECT',
  recipientId: string,
  title: string,
  message: string,
  linkUrl: string,
) {
  try {
    await createNotification({ type: type as never, recipientId, title, message, linkUrl })
  } catch (e) {
    console.error('[disavow] notification failed', type, (e as Error)?.name)
  }
}

/** Discord ids of the people a disavowal is about (every identifier resolved). */
export const subjectDiscordIds = discordIdsForIdentifiers

/**
 * Whether `discordId` is the subject of these identifiers: matches the person's
 * Discord id, member id, wallets and X handle (never name or Telegram).
 */
export async function isSubjectOf(identifiers: ReadonlyArray<{ kind: string; value: string }>, discordId: string): Promise<boolean> {
  const mine = identifierOr(await viewerIdentifiers(discordId))
  return identifiers.some(i => mine.some(m => m.kind === i.kind && m.value === i.value))
}

// ---------------------------------------------------------------- nominate

export type NominateResult =
  | { ok: true; id: string }
  | { ok: false; code: 'rate_limited' }
  | { ok: false; code: 'self' }
  | { ok: false; code: 'duplicate'; existingId: string; existingStatus: string }

/**
 * `defer` runs the slow follow-up work (DPR notifications and the lookups they
 * need) after the response, so a new nomination and a duplicate of a hidden
 * entry take about the same time. The route passes next/server's `after`; by
 * default the work just runs inline.
 */
export async function nominate(input: {
  nominatorDiscordId: string
  displayName: string
  reason: Reason
  statement: string
  evidenceUrls: string[]
  identifiers: IdentifierInput[]
  now?: Date
  defer?: (work: () => Promise<void>) => void | Promise<void>
}): Promise<NominateResult> {
  const now = input.now ?? new Date()
  const since = new Date(now.getTime() - DISAVOW_NOMINATION_WINDOW_DAYS * DAY_MS)

  if (await isSubjectOf(input.identifiers, input.nominatorDiscordId)) return { ok: false, code: 'self' }

  // Names and Telegram handles never count as "the same person".
  const matchable = identifierOr(input.identifiers as IdentifierInput[])
  const closesAt = windowEnd(now, DISAVOW_WINDOW_DAYS)

  // Cap check, duplicate check and create share one transaction behind a lock, so
  // two concurrent nominations can't both slip past the cap or create twins.
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('disavow:nominate'))`
    // Every attempt counts, including duplicates: each writes a NOMINATED event by this actor.
    const attempts = await tx.disavowEvent.count({
      where: { type: 'NOMINATED', actorDiscordId: input.nominatorDiscordId, createdAt: { gte: since } },
    })
    if (attempts >= DISAVOW_NOMINATIONS_PER_WINDOW) return { kind: 'rate_limited' as const }

    const dup = matchable.length
      ? await tx.disavowIdentifier.findFirst({
          where: { OR: matchable, disavowal: { status: { in: [...ACTIVE_STATUSES] } } } as never,
          select: { disavowalId: true, disavowal: { select: { status: true } } },
        })
      : null
    if (dup) {
      // Keep this person's own record of the submission (so they can see and withdraw it).
      await tx.disavowSubmission.upsert({
        where: { disavowalId_submitterDiscordId: { disavowalId: dup.disavowalId, submitterDiscordId: input.nominatorDiscordId } },
        create: { disavowalId: dup.disavowalId, submitterDiscordId: input.nominatorDiscordId, displayName: input.displayName, isOriginal: false },
        update: { withdrawnAt: null },
      })
      await logEvent(tx, dup.disavowalId, 'NOMINATED', input.nominatorDiscordId, { duplicate: true })
      return { kind: 'duplicate' as const, existingId: dup.disavowalId, existingStatus: dup.disavowal.status as string }
    }

    const d = await tx.disavowal.create({
      data: {
        displayName: input.displayName,
        reason: input.reason,
        statement: input.statement,
        evidenceUrls: input.evidenceUrls,
        nominatorDiscordId: input.nominatorDiscordId,
        identifiers: { create: input.identifiers.map(i => ({ kind: i.kind, value: i.value })) },
        rounds: { create: { kind: 'LIST', openedBy: input.nominatorDiscordId, opensAt: now, closesAt } },
        submissions: { create: { submitterDiscordId: input.nominatorDiscordId, displayName: input.displayName, isOriginal: true } },
      },
      select: { id: true },
    })
    await logEvent(tx, d.id, 'NOMINATED', input.nominatorDiscordId, { reason: input.reason })
    await logEvent(tx, d.id, 'ROUND_OPENED', input.nominatorDiscordId, { kind: 'LIST' })
    return { kind: 'created' as const, id: d.id }
  })

  if (result.kind === 'rate_limited') return { ok: false, code: 'rate_limited' }
  if (result.kind === 'duplicate') {
    return { ok: false, code: 'duplicate', existingId: result.existingId, existingStatus: result.existingStatus }
  }
  const work = async () => {
    await notifyDpr(result.id, [input.nominatorDiscordId, ...(await subjectDiscordIds(input.identifiers))])
  }
  if (input.defer) await input.defer(work)
  else await work()
  return { ok: true, id: result.id }
}

async function notifyDpr(disavowalId: string, exclude: string[]) {
  try {
    const dpr = await getMembersWithRoles([DREAD_PIZZA_ROBERTS_ROLE_ID])
    for (const id of dpr) {
      if (exclude.includes(id)) continue
      await notify('DISAVOW_VOTE_NEEDED', id, 'A vote is needed', 'A disavow nomination needs your vote.', `/disavow/${disavowalId}`)
    }
  } catch (e) {
    console.error('[disavow] DPR notify failed', (e as Error)?.name)
  }
}

// -------------------------------------------------------------------- vote

export type VoteResult =
  | { ok: true; outcome: 'pending' | 'passed' | 'failed' }
  | { ok: false; code: 'not_found' | 'closed' | 'conflict' }

export async function castVote(input: {
  disavowalId: string
  roundId: string
  voterDiscordId: string
  choice: 'YES' | 'NO' | 'ABSTAIN' | 'RECUSE'
  comment?: string | null
  now?: Date
}): Promise<VoteResult> {
  const now = input.now ?? new Date()
  const round = await prisma.disavowRound.findUnique({
    where: { id: input.roundId },
    include: { disavowal: { include: { identifiers: true } } },
  })
  if (!round || round.disavowalId !== input.disavowalId) return { ok: false, code: 'not_found' }
  if (round.state !== 'OPEN') return { ok: false, code: 'closed' }
  if (input.voterDiscordId === round.disavowal.nominatorDiscordId || (await isSubjectOf(round.disavowal.identifiers, input.voterDiscordId))) {
    return { ok: false, code: 'conflict' }
  }
  // Anyone who submitted a nomination for this entry (even as a duplicate) can't vote on it.
  const submitted = await prisma.disavowSubmission.findFirst({
    where: { disavowalId: round.disavowalId, submitterDiscordId: input.voterDiscordId },
    select: { id: true },
  })
  if (submitted) return { ok: false, code: 'conflict' }
  if (now.getTime() >= round.closesAt.getTime()) {
    await settleRound(round.id, now)
    return { ok: false, code: 'closed' }
  }

  const accepted = await prisma.$transaction(async tx => {
    await lockRound(tx, round.id)
    // Re-check under the lock: the round may have been settled meanwhile.
    const fresh = await tx.disavowRound.findUnique({ where: { id: round.id }, select: { state: true, closesAt: true } })
    if (!fresh || fresh.state !== 'OPEN' || now.getTime() >= fresh.closesAt.getTime()) return false
    await tx.disavowVote.upsert({
      where: { roundId_voterDiscordId: { roundId: round.id, voterDiscordId: input.voterDiscordId } },
      create: { roundId: round.id, voterDiscordId: input.voterDiscordId, choice: input.choice, comment: input.comment ?? null },
      update: { choice: input.choice, comment: input.comment ?? null },
    })
    await logEvent(tx, round.disavowalId, 'VOTED', input.voterDiscordId, { roundId: round.id, choice: input.choice })
    return true
  })
  if (!accepted) return { ok: false, code: 'closed' }
  const outcome = await settleRound(round.id, now)
  return { ok: true, outcome }
}

// ------------------------------------------------------------------ settle

type Outcome = 'pending' | 'passed' | 'failed'

/**
 * Close a round if its outcome is decided (never before opensAt + 7 days). Safe
 * to call any number of times and concurrently: the count happens in a
 * transaction holding the round's row lock and reading fresh votes, and only
 * the OPEN -> PASSED/FAILED winner writes events and applies effects.
 */
export async function settleRound(roundId: string, now: Date = new Date()): Promise<Outcome> {
  const pre = await prisma.disavowRound.findUnique({
    where: { id: roundId },
    include: { disavowal: { include: { identifiers: true } } },
  })
  if (!pre) return 'pending'
  if (pre.state !== 'OPEN') return pre.state === 'PASSED' ? 'passed' : pre.state === 'FAILED' ? 'failed' : 'pending'
  const subjectIds = await subjectDiscordIds(pre.disavowal.identifiers)

  const res = await prisma.$transaction(async tx => {
    await lockRound(tx, roundId)
    const round = await tx.disavowRound.findUnique({
      where: { id: roundId },
      include: { votes: true, disavowal: true },
    })
    if (!round || round.state !== 'OPEN') return null
    const submissions = await tx.disavowSubmission.findMany({
      where: { disavowalId: round.disavowalId },
      select: { submitterDiscordId: true, withdrawnAt: true },
    })
    const submitterIds = submissions.map(x => x.submitterDiscordId)
    const t = tallyRound(
      round.votes.map(v => ({ voterDiscordId: v.voterDiscordId, choice: v.choice })) as TallyVote[],
      { nominatorId: round.disavowal.nominatorDiscordId, subjectIds, submitterIds, now, opensAt: round.opensAt, closesAt: round.closesAt },
    )
    if (t.outcome === 'pending') return { outcome: 'pending' as Outcome, won: false as const }

    const passed = t.outcome === 'passed'
    const upd = await tx.disavowRound.updateMany({
      where: { id: round.id, state: 'OPEN' },
      data: { state: passed ? 'PASSED' : 'FAILED', closedAt: now },
    })
    if (upd.count === 0) return null
    const d = round.disavowal
    await logEvent(tx, d.id, 'ROUND_CLOSED', null, { roundId: round.id, kind: round.kind, outcome: t.outcome, yes: t.yes, no: t.no })
    if (round.kind === 'LIST') {
      if (passed) {
        await tx.disavowal.updateMany({
          where: { id: d.id, status: 'NOMINATED' },
          data: { status: 'LISTED', listedAt: now, reviewDueAt: addMonths(now, DISAVOW_LISTING_MONTHS) },
        })
        await logEvent(tx, d.id, 'LISTED', null, { from: 'NOMINATED', to: 'LISTED' })
      } else {
        await tx.disavowal.updateMany({ where: { id: d.id, status: 'NOMINATED' }, data: { status: 'REJECTED' } })
      }
    } else if (round.kind === 'REMOVE') {
      if (passed) {
        await tx.disavowal.updateMany({ where: { id: d.id, status: { in: ['LISTED', 'SUSPENDED'] } }, data: { status: 'REMOVED' } })
        await logEvent(tx, d.id, 'REMOVED', null, { to: 'REMOVED' })
      } else if (d.status === 'SUSPENDED') {
        await tx.disavowal.updateMany({ where: { id: d.id, status: 'SUSPENDED' }, data: { status: 'LISTED' } })
        await logEvent(tx, d.id, 'UNSUSPENDED', null, { reason: 'remove round failed' })
      }
    } else if (round.kind === 'REAFFIRM') {
      if (passed) {
        await tx.disavowal.updateMany({ where: { id: d.id, status: 'LISTED' }, data: { reviewDueAt: addMonths(now, DISAVOW_LISTING_MONTHS) } })
      } else {
        await tx.disavowal.updateMany({ where: { id: d.id, status: { in: ['LISTED', 'SUSPENDED'] } }, data: { status: 'EXPIRED' } })
        await logEvent(tx, d.id, 'EXPIRED', null, { to: 'EXPIRED' })
      }
    }
    return {
      outcome: t.outcome as Outcome, won: true as const, kind: round.kind, passed,
      notifyIds: [...new Set(submissions.filter(x => !x.withdrawnAt).map(x => x.submitterDiscordId))],
    }
  })
  if (!res) return 'pending' // someone else settled it, or it was cancelled
  if (!res.won) return res.outcome

  // Best-effort notifications after commit. No names, no content. Every
  // submitter (original and duplicate) gets the identical neutral notice, so a
  // duplicate of a hidden entry is indistinguishable here too.
  if (res.kind === 'LIST' && res.passed) {
    for (const id of subjectIds) {
      await notify('DISAVOW_LISTED_SUBJECT', id, 'A notice about you', 'You can see details and respond.', '/disavow/response')
    }
  }
  for (const id of res.notifyIds) {
    await notify('DISAVOW_ROUND_CLOSED', id, 'A vote has closed', 'A nomination you submitted has closed.', '/disavow?tab=mine')
  }
  return res.outcome
}

// --------------------------------------------------------- other mutations

async function load(id: string) {
  return prisma.disavowal.findUnique({ where: { id }, include: { identifiers: true, rounds: { where: { state: 'OPEN' } } } })
}

/**
 * Withdraw the caller's own submission (by submission id: a duplicate submitter
 * never learns the entry's id). It removes their support; if no active
 * submitter is left and the entry is still NOMINATED, the entry is withdrawn.
 * Nothing is deleted: the submission is stamped, the entry changes status, both
 * audit-logged. Locks the open round first (same order as settleRound).
 */
export async function withdrawSubmission(submissionId: string, actor: string, now = new Date()): Promise<'ok' | 'not_found' | 'already'> {
  const sub = await prisma.disavowSubmission.findUnique({ where: { id: submissionId } })
  if (!sub || sub.submitterDiscordId !== actor) return 'not_found'
  if (sub.withdrawnAt) return 'already'
  return prisma.$transaction(async tx => {
    const open = await tx.disavowRound.findMany({ where: { disavowalId: sub.disavowalId, state: 'OPEN' }, select: { id: true } })
    for (const r of open) await lockRound(tx, r.id)
    const upd = await tx.disavowSubmission.updateMany({ where: { id: submissionId, withdrawnAt: null }, data: { withdrawnAt: now } })
    if (upd.count === 0) return 'already' as const
    await logEvent(tx, sub.disavowalId, 'WITHDRAWN', actor, { submission: true, original: sub.isOriginal })
    const remaining = await tx.disavowSubmission.count({ where: { disavowalId: sub.disavowalId, withdrawnAt: null } })
    if (remaining === 0) {
      const r = await tx.disavowal.updateMany({ where: { id: sub.disavowalId, status: 'NOMINATED' }, data: { status: 'WITHDRAWN' } })
      if (r.count > 0) {
        await tx.disavowRound.updateMany({ where: { disavowalId: sub.disavowalId, state: 'OPEN' }, data: { state: 'CANCELLED', closedAt: now } })
        await logEvent(tx, sub.disavowalId, 'WITHDRAWN', actor, { from: 'NOMINATED', to: 'WITHDRAWN' })
      }
    }
    return 'ok' as const
  })
}

/**
 * The caller's own submissions and nothing else: a neutral status only
 * ("submitted" / "closed" / "withdrawn"), never the entry's status or votes.
 */
export async function listMySubmissions(discordId: string) {
  const rows = await prisma.disavowSubmission.findMany({
    where: { submitterDiscordId: discordId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, displayName: true, createdAt: true, withdrawnAt: true, disavowal: { select: { status: true } } },
  })
  return rows.map(r => ({
    id: r.id,
    displayName: r.displayName,
    createdAt: r.createdAt,
    status: r.withdrawnAt ? ('withdrawn' as const)
      : ['NOMINATED', 'LISTED', 'SUSPENDED'].includes(r.disavowal.status) ? ('submitted' as const) : ('closed' as const),
  }))
}

/** A single DPR hides a listing immediately and a REMOVE vote starts. */
export async function suspend(id: string, actor: string, now = new Date()): Promise<'ok' | 'not_found' | 'bad_state'> {
  const d = await load(id)
  if (!d) return 'not_found'
  if (d.status !== 'LISTED') return 'bad_state'
  try {
    const ok = await prisma.$transaction(async tx => {
      const r = await tx.disavowal.updateMany({ where: { id, status: 'LISTED' }, data: { status: 'SUSPENDED' } })
      if (r.count === 0) return false
      await logEvent(tx, id, 'SUSPENDED', actor, { from: 'LISTED', to: 'SUSPENDED' })
      if (!d.rounds.some(r => r.kind === 'REMOVE')) {
        await tx.disavowRound.create({ data: { disavowalId: id, kind: 'REMOVE', openedBy: actor, opensAt: now, closesAt: windowEnd(now, DISAVOW_WINDOW_DAYS) } })
        await logEvent(tx, id, 'ROUND_OPENED', actor, { kind: 'REMOVE' })
      }
      return true
    })
    return ok ? 'ok' : 'bad_state'
  } catch (e) {
    if (isUniqueViolation(e)) return 'bad_state' // another round opened concurrently; transaction rolled back
    throw e
  }
}

export async function unsuspend(id: string, actor: string): Promise<'ok' | 'not_found' | 'bad_state'> {
  const d = await load(id)
  if (!d) return 'not_found'
  if (d.status !== 'SUSPENDED') return 'bad_state'
  const ok = await prisma.$transaction(async tx => {
    // Lock the open round first, like settleRound, so the two can't deadlock.
    const open = await tx.disavowRound.findMany({ where: { disavowalId: id, state: 'OPEN' }, select: { id: true } })
    for (const r of open) await lockRound(tx, r.id)
    const r = await tx.disavowal.updateMany({ where: { id, status: 'SUSPENDED' }, data: { status: 'LISTED' } })
    if (r.count === 0) return false
    await tx.disavowRound.updateMany({ where: { disavowalId: id, kind: 'REMOVE', state: 'OPEN' }, data: { state: 'CANCELLED', closedAt: new Date() } })
    await logEvent(tx, id, 'UNSUSPENDED', actor, { from: 'SUSPENDED', to: 'LISTED' })
    return true
  })
  return ok ? 'ok' : 'bad_state'
}

/** DPR opens a REMOVE round; a listed member's appeal does the same (90-day cooldown). */
export async function openRemoveRound(
  id: string,
  actor: string,
  opts: { appeal?: boolean; now?: Date } = {},
): Promise<'ok' | 'not_found' | 'bad_state' | 'already_open' | 'too_soon'> {
  const now = opts.now ?? new Date()
  const d = await load(id)
  if (!d) return 'not_found'
  if (d.status !== 'LISTED' && d.status !== 'SUSPENDED') return 'bad_state'
  if (d.rounds.length > 0) return 'already_open'
  if (opts.appeal && d.lastAppealAt && now.getTime() - d.lastAppealAt.getTime() < DISAVOW_APPEAL_COOLDOWN_DAYS * DAY_MS) {
    return 'too_soon'
  }
  try {
    await prisma.$transaction(async tx => {
      // Create first: the partial unique index rejects a second OPEN round and
      // rolls back the appeal bookkeeping with it.
      await tx.disavowRound.create({ data: { disavowalId: id, kind: 'REMOVE', openedBy: actor, opensAt: now, closesAt: windowEnd(now, DISAVOW_WINDOW_DAYS) } })
      if (opts.appeal) {
        await tx.disavowal.update({ where: { id }, data: { lastAppealAt: now } })
        await logEvent(tx, id, 'APPEALED', actor)
      }
      await logEvent(tx, id, 'ROUND_OPENED', actor, { kind: 'REMOVE', appeal: !!opts.appeal })
    })
  } catch (e) {
    if (isUniqueViolation(e)) return 'already_open'
    throw e
  }
  await notifyDpr(id, [d.nominatorDiscordId, ...(await subjectDiscordIds(d.identifiers))])
  return 'ok'
}

/** The listed member's reply, shown beside the listing. Editable; logged. */
export async function addResponse(id: string, actor: string, text: string, now = new Date()): Promise<'ok' | 'not_found' | 'bad_state'> {
  const d = await prisma.disavowal.findUnique({ where: { id }, select: { status: true } })
  if (!d) return 'not_found'
  if (d.status !== 'LISTED' && d.status !== 'SUSPENDED') return 'bad_state'
  await prisma.$transaction(async tx => {
    await tx.disavowal.update({ where: { id }, data: { subjectResponse: text, respondedAt: now } })
    await logEvent(tx, id, 'RESPONSE_ADDED', actor, { length: text.length })
  })
  return 'ok'
}

/**
 * Overwrite the text, the name/handle/wallet identifiers and every DPR vote
 * comment with a marker (legal or erasure request). The row, status, votes and
 * audit trail stay; the event names the fields but never their contents. An
 * admin who is the subject can't redact their own entry.
 */
export async function redact(id: string, actor: string, now = new Date()): Promise<'ok' | 'not_found' | 'conflict'> {
  const d = await prisma.disavowal.findUnique({ where: { id }, include: { identifiers: true } })
  if (!d) return 'not_found'
  if (await isSubjectOf(d.identifiers, actor)) return 'conflict'
  const fields = ['displayName', 'statement', 'evidenceUrls', 'subjectResponse', 'identifiers', 'voteComments', 'submissionNames']
  await prisma.$transaction(async tx => {
    await tx.disavowal.update({
      where: { id },
      data: {
        displayName: REDACTED,
        statement: REDACTED,
        evidenceUrls: [],
        subjectResponse: d.subjectResponse ? REDACTED : null,
        redactedAt: now,
      },
    })
    for (const i of d.identifiers) {
      if (i.kind === 'NAME' || i.kind === 'X_HANDLE' || i.kind === 'WALLET' || i.kind === 'TELEGRAM') {
        await tx.disavowIdentifier.update({ where: { id: i.id }, data: { value: `${REDACTED}:${i.id}` } })
      }
    }
    await tx.disavowSubmission.updateMany({ where: { disavowalId: id }, data: { displayName: REDACTED } })
    await tx.disavowVote.updateMany({ where: { round: { disavowalId: id }, comment: { not: null } } as never, data: { comment: REDACTED } })
    await logEvent(tx, id, 'REDACTED', actor, { fields })
  })
  return 'ok'
}

/** Audit-log a view (first per viewer per day) to deter leaks. */
export async function recordView(id: string, viewer: string, now = new Date()): Promise<void> {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  try {
    const seen = await prisma.disavowEvent.findFirst({
      where: { disavowalId: id, type: 'VIEWED', actorDiscordId: viewer, createdAt: { gte: dayStart } },
      select: { id: true },
    })
    if (seen) return
    await prisma.disavowEvent.create({ data: { disavowalId: id, type: 'VIEWED', actorDiscordId: viewer } })
  } catch (e) {
    console.error('[disavow] view log failed', id, (e as Error)?.name)
  }
}

// -------------------------------------------------------------------- cron

/** Settle rounds that are decided (never before day 7) and open REAFFIRM rounds past their review date. */
export async function runDisavowCron(now: Date = new Date()) {
  const open = await prisma.disavowRound.findMany({ where: { state: 'OPEN' }, select: { id: true } })
  let settled = 0
  for (const r of open) {
    try {
      if ((await settleRound(r.id, now)) !== 'pending') settled++
    } catch (e) {
      console.error('[cron/disavow] settle failed', r.id, (e as Error)?.name)
    }
  }
  const due = await prisma.disavowal.findMany({
    where: { status: 'LISTED', reviewDueAt: { lte: now }, rounds: { none: { state: 'OPEN' } } },
    select: { id: true },
  })
  let reaffirmOpened = 0
  for (const d of due) {
    try {
      await prisma.$transaction(async tx => {
        await tx.disavowRound.create({ data: { disavowalId: d.id, kind: 'REAFFIRM', openedBy: 'system', opensAt: now, closesAt: windowEnd(now, DISAVOW_WINDOW_DAYS) } })
        await logEvent(tx, d.id, 'ROUND_OPENED', null, { kind: 'REAFFIRM' })
      })
      reaffirmOpened++
      await notifyDpr(d.id, [])
    } catch (e) {
      if (!isUniqueViolation(e)) console.error('[cron/disavow] reaffirm failed', d.id, (e as Error)?.name)
    }
  }
  return { settled, reaffirmOpened }
}
