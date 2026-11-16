/**
 * The public status of each stored action item: done (a check), in progress (a cycle arrow) or
 * nothing. It comes from what the reviewers marked (`done` + `evidence` on the item, which always
 * wins) and from the follow-ups linked to the item by `actionKey` (members' answers). Needs-help is
 * shown as in progress: asking for help is not announced publicly. Used by the Discord recap and
 * the public call page, only while calls.recapLiveStatusEnabled is on.
 */
import type { FollowUpStatus } from '@prisma/client'
import { prisma } from '@/app/lib/db'
import { MAX_EVIDENCE, readEvidence, safeEvidenceUrl, evidenceLabel } from '@/app/lib/calls/evidence'
import { mentionsBlockedTerm, EMPTY_POST_FILTER, type PostFilter } from '@/app/lib/calls/post-filters'
import { toggleEnabled } from '@/app/lib/settings/toggles'

export type ActionState = 'done' | 'in_progress' | null

/** One entry per stored action item, same order and length as the stored list. */
export interface ActionView {
  key?: string
  state: ActionState
  /** Finished-work links, shown only on done items. */
  links: Array<{ url: string; label: string }>
}

export interface FollowUpStatusRow {
  actionKey: string | null
  status: FollowUpStatus
  doneUrl: string | null
}

const WORKING: readonly FollowUpStatus[] = ['IN_PROGRESS', 'NEEDS_HELP']

export function deriveActionViews(items: unknown, followUps: readonly FollowUpStatusRow[], opts: { memberLinks: boolean; filter?: PostFilter } = { memberLinks: true }): ActionView[] {
  const filter = opts.filter ?? EMPTY_POST_FILTER
  const byKey = new Map<string, FollowUpStatusRow[]>()
  for (const f of followUps) if (f.actionKey) byKey.set(f.actionKey, [...(byKey.get(f.actionKey) ?? []), f])
  return (Array.isArray(items) ? items : []).map((raw) => {
    const o = (raw && typeof raw === 'object' ? raw : {}) as { key?: unknown; done?: unknown; evidence?: unknown }
    const key = typeof o.key === 'string' ? o.key : undefined
    const linked = key ? (byKey.get(key) ?? []) : []
    const adminDone = o.done === true
    const state: ActionState = adminDone ? 'done' : linked.some((f) => WORKING.includes(f.status)) ? 'in_progress' : linked.some((f) => f.status === 'DONE') ? 'done' : null
    if (state !== 'done') return { ...(key ? { key } : {}), state, links: [] }
    const member = opts.memberLinks ? linked.filter((f) => f.status === 'DONE').map((f) => safeEvidenceUrl(f.doneUrl)) : []
    const urls = [...(adminDone ? readEvidence(o.evidence).map((e) => e.url) : []), ...member.filter((u): u is string => !!u)]
    const links: ActionView['links'] = []
    for (const url of urls) {
      // A link the post filter blocks is dropped, never the item.
      if (links.some((l) => l.url === url) || mentionsBlockedTerm(url, filter)) continue
      links.push({ url, label: evidenceLabel(url) })
      if (links.length >= MAX_EVIDENCE) break
    }
    return { ...(key ? { key } : {}), state, links }
  })
}

/** Views for one call: a single query for its keyed follow-ups. A database error leaves the reviewers' marks only. */
export async function loadActionViews(rec: { id: string; actionItems: unknown }, filter?: PostFilter): Promise<ActionView[]> {
  const memberLinks = await toggleEnabled('calls.recapMemberLinksEnabled').catch(() => false)
  const followUps = await prisma.followUp
    .findMany({ where: { recordingId: rec.id, actionKey: { not: null } }, select: { actionKey: true, status: true, doneUrl: true } })
    .catch((err: unknown) => {
      console.error('[calls/action-status] follow-ups unavailable:', err instanceof Error ? err.message : err)
      return [] as FollowUpStatusRow[]
    })
  return deriveActionViews(rec.actionItems, followUps, { memberLinks, filter })
}
