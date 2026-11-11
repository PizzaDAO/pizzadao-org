/**
 * Glue between the store and the outside world: open a new proposal (snapshot + window), tell Discord, and the
 * hourly run that retries what was missed, closes what is due and posts results.
 */
import { prisma } from '@/app/lib/db'
import { CLOSE_MARGIN_MS, DRAFT_RETRY_MS } from './constants'
import { alertStuck, announceCancelled, announceOpen, announceResult, type PostDeps, defaultPostDeps } from './discord'
import { KeyConfigError } from './keys'
import type { PendingStore } from './pending'
import { cancelProposal, drainPending, openProposal, settleProposal, type CancelActor, type CancelResult } from './store'

/** A draft that has waited this long without opening is reported to the ops channel (once). */
export const STUCK_AFTER_MS = 2 * 60 * 60 * 1000
/** The same failure code is written to a proposal's log at most this often. */
const FAILURE_REPEAT_MS = 6 * 60 * 60 * 1000

/** A short code for why an open attempt threw. Never the message: it could carry anything. */
export function openFailureCode(e: unknown): string {
  if (e instanceof KeyConfigError) return 'key_config'
  const msg = e instanceof Error ? e.message : ''
  if (msg === 'voter role not resolved') return 'voter_role'
  if (msg === 'guild member listing incomplete') return 'listing_incomplete'
  return 'error'
}

/** Failures that are normal (a preview, a race, a finished pilot) and not worth a log row. */
const QUIET_CODES = new Set(['not_production', 'not_found', 'not_draft', 'pilot_over'])

/**
 * Record why a draft did not open, as an OPEN_FAILED event (code only), so the proposer's page and /admin/proposals can
 * say so. The same code on the same proposal is written again only after a few hours (the cron retries hourly).
 */
export async function noteOpenFailure(id: string, code: string, now: Date = new Date()): Promise<void> {
  if (QUIET_CODES.has(code)) return
  try {
    const last = await prisma.proposalEvent.findFirst({ where: { proposalId: id, type: 'OPEN_FAILED' }, orderBy: { createdAt: 'desc' }, select: { data: true, createdAt: true } })
    const same = (last?.data as { code?: string } | null)?.code === code
    if (last && same && now.getTime() - new Date(last.createdAt).getTime() < FAILURE_REPEAT_MS) return
    await prisma.proposalEvent.create({ data: { proposalId: id, type: 'OPEN_FAILED', actorDiscordId: null, data: { code } as never } })
  } catch (e) {
    console.error('[proposals] could not record open failure:', (e as Error)?.name)
  }
}

/** Open a DRAFT proposal, then post it. Never throws: a failed open leaves a DRAFT (with the reason logged) that the cron retries. */
export async function openAndAnnounce(id: string, deps: PostDeps = defaultPostDeps): Promise<void> {
  try {
    const r = await openProposal(id)
    if (r.ok) await announceOpen(id, deps)
    else await noteOpenFailure(id, r.code)
  } catch (e) {
    console.error('[proposals] open failed:', (e as Error)?.name)
    await noteOpenFailure(id, openFailureCode(e))
  }
}

/** Cancel (admin) or withdraw (proposer), then update the Discord post. The post is best effort. */
export async function cancelAndAnnounce(id: string, actor: CancelActor, reason: unknown, deps: PostDeps = defaultPostDeps, opts: { now?: Date; pending?: PendingStore | null } = {}): Promise<CancelResult> {
  const r = await cancelProposal(id, actor, reason, { now: opts.now, pending: opts.pending })
  if (r.ok && r.wasOpen) await announceCancelled(id, deps).catch(() => {})
  return r
}

export interface CronResult {
  opened: number
  settled: number
  /** Pending votes moved into the ballot table for proposals still open. */
  drained: number
  openPosts: number
  resultPosts: number
  /** Drafts waiting more than 2 hours that the ops channel was told about this run. */
  stuckAlerted: number
}

/** Most drafts opened per run (each takes a full eligibility snapshot). */
const MAX_OPENS_PER_RUN = 3

export async function runProposalsCron(now: Date = new Date(), deps: PostDeps = defaultPostDeps, opts: { pending?: PendingStore | null } = {}): Promise<CronResult> {
  const out: CronResult = { opened: 0, settled: 0, drained: 0, openPosts: 0, resultPosts: 0, stuckAlerted: 0 }

  const drafts: Array<{ id: string }> = await prisma.proposal.findMany({
    where: { source: 'APP', status: 'DRAFT', createdAt: { lte: new Date(now.getTime() - DRAFT_RETRY_MS) } },
    orderBy: { createdAt: 'asc' },
    take: MAX_OPENS_PER_RUN,
    select: { id: true },
  })
  for (const d of drafts) {
    try {
      const r = await openProposal(d.id, { now })
      if (r.ok) out.opened++
      else await noteOpenFailure(d.id, r.code, now)
    } catch (e) {
      console.error('[proposals] cron open failed:', (e as Error)?.name)
      await noteOpenFailure(d.id, openFailureCode(e), now)
    }
  }

  const due: Array<{ id: string }> = await prisma.proposal.findMany({ where: { source: 'APP', status: 'OPEN', closesAt: { lte: new Date(now.getTime() - CLOSE_MARGIN_MS) } }, select: { id: true } })
  for (const p of due) {
    try {
      if ((await settleProposal(p.id, now, { pending: opts.pending })).ok) out.settled++
    } catch (e) {
      console.error('[proposals] settle failed:', (e as Error)?.name)
    }
  }

  // Proposals still open: move their pending votes into the table (one sorted transaction each).
  const stillOpen: Array<{ id: string }> = await prisma.proposal.findMany({ where: { source: 'APP', status: 'OPEN' }, select: { id: true } })
  for (const p of stillOpen) {
    try {
      out.drained += await drainPending(p.id, { pending: opts.pending })
    } catch (e) {
      console.error('[proposals] drain failed:', (e as Error)?.name)
    }
  }

  const unposted: Array<{ id: string }> = await prisma.proposal.findMany({ where: { source: 'APP', status: 'OPEN', discordChannelId: null }, select: { id: true } })
  for (const p of unposted) if ((await announceOpen(p.id, deps).catch(() => 'failed')) === 'posted') out.openPosts++

  const unannounced: Array<{ id: string }> = await prisma.proposal.findMany({
    where: { source: 'APP', status: { in: ['PASSED', 'FAILED'] }, resultPostedAt: null },
    select: { id: true },
  })
  for (const p of unannounced) if ((await announceResult(p.id, now, deps).catch(() => 'failed')) === 'posted') out.resultPosts++

  // Drafts that still have not opened after 2 hours: tell the ops channel once (the admin page lists them regardless).
  try {
    const stuck: Array<{ id: string }> = await prisma.proposal.findMany({
      where: { source: 'APP', status: 'DRAFT', createdAt: { lte: new Date(now.getTime() - STUCK_AFTER_MS) } },
      select: { id: true },
    })
    if (stuck.length) {
      const told: Array<{ proposalId: string }> = await prisma.proposalEvent.findMany({ where: { type: 'STUCK_ALERTED', proposalId: { in: stuck.map((x) => x.id) } }, select: { proposalId: true } })
      const done = new Set(told.map((e) => e.proposalId))
      const fresh = stuck.filter((x) => !done.has(x.id))
      if (fresh.length && (await alertStuck(fresh.length, deps))) {
        for (const x of fresh) await prisma.proposalEvent.create({ data: { proposalId: x.id, type: 'STUCK_ALERTED', actorDiscordId: null } })
        out.stuckAlerted = fresh.length
      }
    }
  } catch (e) {
    console.error('[proposals] stuck alert failed:', (e as Error)?.name)
  }

  return out
}
