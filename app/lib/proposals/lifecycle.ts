/**
 * Glue between the store and the outside world: open a new proposal (snapshot + window), tell Discord, and the
 * daily run that retries what was missed, closes what is due and posts results.
 */
import { prisma } from '@/app/lib/db'
import { DRAFT_RETRY_MS } from './constants'
import { announceOpen, announceResult, type PostDeps, defaultPostDeps } from './discord'
import { openProposal, settleProposal } from './store'

/** Open a DRAFT proposal, then post it. Never throws: a failed open leaves a DRAFT that the cron retries. */
export async function openAndAnnounce(id: string, deps: PostDeps = defaultPostDeps): Promise<void> {
  try {
    const r = await openProposal(id)
    if (r.ok) await announceOpen(id, deps)
  } catch (e) {
    console.error('[proposals] open failed:', (e as Error)?.name)
  }
}

export interface CronResult {
  opened: number
  settled: number
  openPosts: number
  resultPosts: number
}

/** Most drafts opened per run (each takes a full eligibility snapshot). */
const MAX_OPENS_PER_RUN = 3

export async function runProposalsCron(now: Date = new Date(), deps: PostDeps = defaultPostDeps): Promise<CronResult> {
  const out: CronResult = { opened: 0, settled: 0, openPosts: 0, resultPosts: 0 }

  const drafts: Array<{ id: string }> = await prisma.proposal.findMany({
    where: { status: 'DRAFT', createdAt: { lte: new Date(now.getTime() - DRAFT_RETRY_MS) } },
    orderBy: { createdAt: 'asc' },
    take: MAX_OPENS_PER_RUN,
    select: { id: true },
  })
  for (const d of drafts) {
    try {
      const r = await openProposal(d.id, { now })
      if (r.ok) out.opened++
    } catch (e) {
      console.error('[proposals] cron open failed:', (e as Error)?.name)
    }
  }

  const due: Array<{ id: string }> = await prisma.proposal.findMany({ where: { status: 'OPEN', closesAt: { lte: now } }, select: { id: true } })
  for (const p of due) {
    try {
      if ((await settleProposal(p.id, now)).ok) out.settled++
    } catch (e) {
      console.error('[proposals] settle failed:', (e as Error)?.name)
    }
  }

  const unposted: Array<{ id: string }> = await prisma.proposal.findMany({ where: { status: 'OPEN', discordChannelId: null }, select: { id: true } })
  for (const p of unposted) if ((await announceOpen(p.id, deps).catch(() => 'failed')) === 'posted') out.openPosts++

  const unannounced: Array<{ id: string }> = await prisma.proposal.findMany({
    where: { status: { in: ['PASSED', 'FAILED'] }, resultPostedAt: null },
    select: { id: true },
  })
  for (const p of unannounced) if ((await announceResult(p.id, now, deps).catch(() => 'failed')) === 'posted') out.resultPosts++

  return out
}
