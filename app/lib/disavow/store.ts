/**
 * Disavow list mutations. Rules (plans/disavow-list.md):
 *  - nothing is ever deleted: status changes and redaction only;
 *  - every mutation runs in one transaction and appends a DisavowEvent;
 *  - settling a round is idempotent (guarded by `state = OPEN` in the update);
 *  - notifications carry no names or content and are best-effort.
 */
import { prisma } from '@/app/lib/db'
import { createNotification } from '@/app/lib/notifications'
import { getMembersWithRoles } from '@/app/lib/discord'
import { DREAD_PIZZA_ROBERTS_ROLE_ID } from '@/app/ui/constants'
import { fetchMemberById, fetchMemberIdByDiscordId } from '@/app/lib/sheets/member-repository'
import {
  DAY_MS, DISAVOW_APPEAL_COOLDOWN_DAYS, DISAVOW_LISTING_MONTHS, DISAVOW_NOMINATIONS_PER_WINDOW,
  DISAVOW_NOMINATION_WINDOW_DAYS, DISAVOW_WINDOW_DAYS, REDACTED,
} from './constants'
import type { IdentifierInput } from './identity'
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

/** Discord ids of the people a disavowal is about (direct, plus via member id). */
export async function subjectDiscordIds(identifiers: ReadonlyArray<{ kind: string; value: string }>): Promise<string[]> {
  const out = new Set<string>()
  for (const i of identifiers) {
    if (i.kind === 'DISCORD_ID') out.add(i.value)
    if (i.kind === 'MEMBER_ID') {
      try {
        const m = await fetchMemberById(i.value)
        if (m?.discordId) out.add(m.discordId)
      } catch { /* ignore */ }
    }
  }
  return [...out]
}

/** Whether `discordId` is the subject of these identifiers (Discord id or member id). */
export async function isSubjectOf(identifiers: ReadonlyArray<{ kind: string; value: string }>, discordId: string): Promise<boolean> {
  if (identifiers.some(i => i.kind === 'DISCORD_ID' && i.value === discordId)) return true
  const memberId = await fetchMemberIdByDiscordId(discordId).catch(() => null)
  return !!memberId && identifiers.some(i => i.kind === 'MEMBER_ID' && i.value === memberId)
}

// ---------------------------------------------------------------- nominate

export type NominateResult =
  | { ok: true; id: string }
  | { ok: false; code: 'rate_limited' }
  | { ok: false; code: 'self' }
  | { ok: false; code: 'duplicate'; existingId: string }

export async function nominate(input: {
  nominatorDiscordId: string
  displayName: string
  reason: Reason
  statement: string
  evidenceUrls: string[]
  identifiers: IdentifierInput[]
  now?: Date
}): Promise<NominateResult> {
  const now = input.now ?? new Date()
  const since = new Date(now.getTime() - DISAVOW_NOMINATION_WINDOW_DAYS * DAY_MS)
  const recent = await prisma.disavowal.count({
    where: { nominatorDiscordId: input.nominatorDiscordId, createdAt: { gte: since } },
  })
  if (recent >= DISAVOW_NOMINATIONS_PER_WINDOW) return { ok: false, code: 'rate_limited' }

  if (await isSubjectOf(input.identifiers, input.nominatorDiscordId)) return { ok: false, code: 'self' }

  const dup = await prisma.disavowIdentifier.findFirst({
    where: {
      OR: input.identifiers.map(i => ({ kind: i.kind, value: i.value })),
      disavowal: { status: { in: [...ACTIVE_STATUSES] } },
    } as never,
    select: { disavowalId: true },
  })
  if (dup) return { ok: false, code: 'duplicate', existingId: dup.disavowalId }

  const closesAt = windowEnd(now, DISAVOW_WINDOW_DAYS)
  const created = await prisma.$transaction(async tx => {
    const d = await tx.disavowal.create({
      data: {
        displayName: input.displayName,
        reason: input.reason,
        statement: input.statement,
        evidenceUrls: input.evidenceUrls,
        nominatorDiscordId: input.nominatorDiscordId,
        identifiers: { create: input.identifiers.map(i => ({ kind: i.kind, value: i.value })) },
        rounds: { create: { kind: 'LIST', openedBy: input.nominatorDiscordId, opensAt: now, closesAt } },
      },
      select: { id: true },
    })
    await logEvent(tx, d.id, 'NOMINATED', input.nominatorDiscordId, { reason: input.reason })
    await logEvent(tx, d.id, 'ROUND_OPENED', input.nominatorDiscordId, { kind: 'LIST' })
    return d
  })

  await notifyDpr(created.id, [input.nominatorDiscordId, ...(await subjectDiscordIds(input.identifiers))])
  return { ok: true, id: created.id }
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
  const ids = round.disavowal.identifiers
  if (input.voterDiscordId === round.disavowal.nominatorDiscordId || (await isSubjectOf(ids, input.voterDiscordId))) {
    return { ok: false, code: 'conflict' }
  }
  if (now.getTime() >= round.closesAt.getTime()) {
    await settleRound(round.id, now)
    return { ok: false, code: 'closed' }
  }

  await prisma.$transaction(async tx => {
    await tx.disavowVote.upsert({
      where: { roundId_voterDiscordId: { roundId: round.id, voterDiscordId: input.voterDiscordId } },
      create: { roundId: round.id, voterDiscordId: input.voterDiscordId, choice: input.choice, comment: input.comment ?? null },
      update: { choice: input.choice, comment: input.comment ?? null },
    })
    await logEvent(tx, round.disavowalId, 'VOTED', input.voterDiscordId, { roundId: round.id, choice: input.choice })
  })
  const outcome = await settleRound(round.id, now)
  return { ok: true, outcome }
}

// ------------------------------------------------------------------ settle

/**
 * Close a round if its outcome is decided. Safe to call any number of times and
 * concurrently: the OPEN -> PASSED/FAILED update is the single winner, and only
 * the winner writes events and applies effects.
 */
export async function settleRound(roundId: string, now: Date = new Date()): Promise<'pending' | 'passed' | 'failed'> {
  const round = await prisma.disavowRound.findUnique({
    where: { id: roundId },
    include: { votes: true, disavowal: { include: { identifiers: true } } },
  })
  if (!round || round.state !== 'OPEN') {
    return round?.state === 'PASSED' ? 'passed' : round?.state === 'FAILED' ? 'failed' : 'pending'
  }
  const subjectIds = await subjectDiscordIds(round.disavowal.identifiers)
  const t = tallyRound(
    round.votes.map(v => ({ voterDiscordId: v.voterDiscordId, choice: v.choice })) as TallyVote[],
    { nominatorId: round.disavowal.nominatorDiscordId, subjectIds, now, opensAt: round.opensAt, closesAt: round.closesAt },
  )
  if (t.outcome === 'pending') return 'pending'

  const passed = t.outcome === 'passed'
  const won = await prisma.$transaction(async tx => {
    const res = await tx.disavowRound.updateMany({
      where: { id: round.id, state: 'OPEN' },
      data: { state: passed ? 'PASSED' : 'FAILED', closedAt: now },
    })
    if (res.count === 0) return false
    const d = round.disavowal
    const tallyData = { roundId: round.id, kind: round.kind, outcome: t.outcome, yes: t.yes, no: t.no }
    await logEvent(tx, d.id, 'ROUND_CLOSED', null, tallyData)
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
        await tx.disavowal.updateMany({
          where: { id: d.id, status: 'LISTED' },
          data: { reviewDueAt: addMonths(now, DISAVOW_LISTING_MONTHS) },
        })
      } else {
        await tx.disavowal.updateMany({ where: { id: d.id, status: { in: ['LISTED', 'SUSPENDED'] } }, data: { status: 'EXPIRED' } })
        await logEvent(tx, d.id, 'EXPIRED', null, { to: 'EXPIRED' })
      }
    }
    return true
  })
  if (!won) return t.outcome

  // Best-effort notifications after commit. No names, no content.
  if (round.kind === 'LIST') {
    if (passed) {
      for (const id of subjectIds) {
        await notify('DISAVOW_LISTED_SUBJECT', id, 'A notice about you', 'You can see details and respond.', '/disavow/response')
      }
    }
    await notify(
      'DISAVOW_ROUND_CLOSED', round.disavowal.nominatorDiscordId, 'A vote has closed',
      passed ? 'A nomination you made passed.' : 'A nomination you made did not pass.', '/disavow',
    )
  }
  return t.outcome
}

// --------------------------------------------------------- other mutations

async function load(id: string) {
  return prisma.disavowal.findUnique({ where: { id }, include: { identifiers: true, rounds: { where: { state: 'OPEN' } } } })
}

export async function withdraw(id: string, actor: string): Promise<'ok' | 'not_found' | 'forbidden' | 'bad_state'> {
  const d = await load(id)
  if (!d) return 'not_found'
  if (d.nominatorDiscordId !== actor) return 'forbidden'
  if (d.status !== 'NOMINATED') return 'bad_state'
  const ok = await prisma.$transaction(async tx => {
    const r = await tx.disavowal.updateMany({ where: { id, status: 'NOMINATED' }, data: { status: 'WITHDRAWN' } })
    if (r.count === 0) return false
    await tx.disavowRound.updateMany({ where: { disavowalId: id, state: 'OPEN' }, data: { state: 'CANCELLED', closedAt: new Date() } })
    await logEvent(tx, id, 'WITHDRAWN', actor, { from: 'NOMINATED', to: 'WITHDRAWN' })
    return true
  })
  return ok ? 'ok' : 'bad_state'
}

/** A single DPR hides a listing immediately and a REMOVE vote starts. */
export async function suspend(id: string, actor: string, now = new Date()): Promise<'ok' | 'not_found' | 'bad_state'> {
  const d = await load(id)
  if (!d) return 'not_found'
  if (d.status !== 'LISTED') return 'bad_state'
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
}

export async function unsuspend(id: string, actor: string): Promise<'ok' | 'not_found' | 'bad_state'> {
  const d = await load(id)
  if (!d) return 'not_found'
  if (d.status !== 'SUSPENDED') return 'bad_state'
  const ok = await prisma.$transaction(async tx => {
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
  await prisma.$transaction(async tx => {
    if (opts.appeal) {
      await tx.disavowal.update({ where: { id }, data: { lastAppealAt: now } })
      await logEvent(tx, id, 'APPEALED', actor)
    }
    await tx.disavowRound.create({ data: { disavowalId: id, kind: 'REMOVE', openedBy: actor, opensAt: now, closesAt: windowEnd(now, DISAVOW_WINDOW_DAYS) } })
    await logEvent(tx, id, 'ROUND_OPENED', actor, { kind: 'REMOVE', appeal: !!opts.appeal })
  })
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
 * Overwrite the text and name/handle/wallet identifiers with a marker (legal or
 * erasure request). The row, status, and audit trail stay; the event names the
 * fields but never their contents.
 */
export async function redact(id: string, actor: string, now = new Date()): Promise<'ok' | 'not_found'> {
  const d = await prisma.disavowal.findUnique({ where: { id }, include: { identifiers: true } })
  if (!d) return 'not_found'
  const fields = ['displayName', 'statement', 'evidenceUrls', 'subjectResponse', 'identifiers']
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

/** Settle due rounds and open REAFFIRM rounds for listings past their review date. */
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
    await prisma.$transaction(async tx => {
      await tx.disavowRound.create({ data: { disavowalId: d.id, kind: 'REAFFIRM', openedBy: 'system', opensAt: now, closesAt: windowEnd(now, DISAVOW_WINDOW_DAYS) } })
      await logEvent(tx, d.id, 'ROUND_OPENED', null, { kind: 'REAFFIRM' })
    })
    reaffirmOpened++
    await notifyDpr(d.id, [])
  }
  return { settled, reaffirmOpened }
}
