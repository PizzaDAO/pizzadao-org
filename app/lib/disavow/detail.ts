/**
 * Detail view of one disavowal, shaped per viewer. DPR get the nominator,
 * tallies and private vote comments; everyone else sees only the claim, the
 * member's response and a sanitized history. Used by the API and the page.
 */
import { prisma } from '@/app/lib/db'
import { DISAVOW_PAGE_SIZE } from './constants'
import { identifierOr, viewerIdentifiers } from './match'
import { settleRound, recordView, subjectDiscordIds, isSubjectOf } from './store'
import { tallyRound } from './tally'

const TABS: Record<string, string[]> = {
  listed: ['LISTED'],
  open: ['NOMINATED'],
  suspended: ['SUSPENDED'],
  closed: ['REJECTED', 'WITHDRAWN', 'REMOVED', 'EXPIRED'],
}

/** Paginated list. Non-DPR viewers always get the LISTED tab. Never includes the nominator. */
export async function listDisavowals(tabIn: string | null | undefined, pageIn: unknown, isDPR: boolean, viewerDiscordId: string) {
  let tab = tabIn ?? 'listed'
  if (!(tab in TABS) || (tab !== 'listed' && !isDPR)) tab = 'listed'
  const page = Math.max(1, Math.floor(Number(pageIn) || 1))
  // Never list an entry about the viewer themself (e.g. while they are only NOMINATED).
  const mine = identifierOr(await viewerIdentifiers(viewerDiscordId))
  const where = {
    status: { in: TABS[tab] },
    ...(mine.length ? { NOT: { identifiers: { some: { OR: mine } } } } : {}),
  } as never
  const [total, items] = await Promise.all([
    prisma.disavowal.count({ where }),
    prisma.disavowal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * DISAVOW_PAGE_SIZE,
      take: DISAVOW_PAGE_SIZE,
      select: { id: true, displayName: true, reason: true, status: true, listedAt: true, reviewDueAt: true, createdAt: true },
    }),
  ])
  return { tab, page, pageSize: DISAVOW_PAGE_SIZE, total, items }
}

export async function getDisavowDetail(id: string, viewer: { discordId: string; isDPR: boolean }) {
  // Access checks first, on a light read: nobody who may not see this entry
  // (its subject, or a non-DPR viewer of a hidden one) can make us settle or log anything.
  const head = await prisma.disavowal.findUnique({
    where: { id },
    select: { id: true, status: true, identifiers: true },
  })
  if (!head) return null
  if (await isSubjectOf(head.identifiers, viewer.discordId)) return null
  // Non-DPR viewers only ever see LISTED entries. Their own nominations live
  // under "My nominations", which shows no entry details.
  if (!viewer.isDPR && head.status !== 'LISTED') return null

  const open = await prisma.disavowRound.findMany({ where: { disavowalId: id, state: 'OPEN' }, select: { id: true } })
  for (const r of open) await settleRound(r.id).catch(() => 'pending')

  const d = await prisma.disavowal.findUnique({
    where: { id },
    include: {
      identifiers: true,
      rounds: { include: { votes: true }, orderBy: { opensAt: 'desc' } },
      events: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!d) return null
  // Settling may have changed the status (e.g. a removal passed).
  if (!viewer.isDPR && d.status !== 'LISTED') return null

  await recordView(id, viewer.discordId)

  const subjectIds = await subjectDiscordIds(d.identifiers)
  const now = new Date()
  const base = {
    id: d.id,
    status: d.status,
    displayName: d.displayName,
    reason: d.reason,
    statement: d.statement,
    evidenceUrls: d.evidenceUrls,
    subjectResponse: d.subjectResponse,
    respondedAt: d.respondedAt,
    listedAt: d.listedAt,
    reviewDueAt: d.reviewDueAt,
    redacted: !!d.redactedAt,
    history: d.events
      .filter(e => e.type !== 'VIEWED' && e.type !== 'VOTED' && !(e.data as { duplicate?: boolean } | null)?.duplicate)
      .map(e => ({ type: e.type, at: e.createdAt })),
  }
  if (!viewer.isDPR) return base

  const rounds = d.rounds.map(r => {
    const t = tallyRound(
      r.votes.map(v => ({ voterDiscordId: v.voterDiscordId, choice: v.choice })),
      { nominatorId: d.nominatorDiscordId, subjectIds, now, opensAt: r.opensAt, closesAt: r.closesAt },
    )
    return {
      id: r.id, kind: r.kind, state: r.state, opensAt: r.opensAt, closesAt: r.closesAt,
      tally: { yes: t.yes, no: t.no, abstain: t.abstain, recused: t.recused },
      myVote: r.votes.find(v => v.voterDiscordId === viewer.discordId)?.choice ?? null,
      comments: r.votes.filter(v => v.comment).map(v => ({ choice: v.choice, comment: v.comment })),
    }
  })
  return { ...base, nominatorDiscordId: d.nominatorDiscordId, identifiers: d.identifiers.map(i => ({ kind: i.kind, value: i.value })), rounds }
}
