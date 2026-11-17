/**
 * The "Since last call" block of a pre-call agenda: the action items of the crew's last published
 * call, each with its status (done, in progress, not started) and the finished-work link.
 *
 * Status comes only from calls/action-status.ts. While calls.recapLiveStatusEnabled is off, only the
 * reviewers' done marks (and their links) count, so the agenda never shows a state the public recap
 * does not. Privacy follows the spoken updates script: excluded crews and blocked terms are dropped,
 * a last call whose redactions are newer than its summary is left out whole, and a redacted speaker
 * is never named as an owner.
 */
import { prisma } from '@/app/lib/db'
import { clipTo, type ReviewLine } from './rank'
import { DISCORD_ONLY, importedAllowed } from '@/app/lib/calls/imported'
import { mentionsBlockedTerm, type PostFilter } from '@/app/lib/calls/post-filters'
import { deriveActionViews, loadActionViews, type ActionView } from '@/app/lib/calls/action-status'
import { maskedLink } from '@/app/lib/calls/evidence'
import { redactedSpeakerNames } from '@/app/lib/calls/redacted-names'
import { redactionsNewerThanSummary } from '@/app/lib/calls/recap'
import type { Settings } from '@/app/lib/settings'
import { resolveToggle } from '@/app/lib/settings/toggles'
import { settingInt } from '@/app/lib/settings/numbers'

const DAY_MS = 24 * 60 * 60 * 1000
const OWNER_CHARS = 40
const MAX_LINK_URL = 200

export type ReviewSkip = 'none' | 'stale-redactions' | 'filtered'

export interface AgendaReviewData {
  recordingId: string
  startedAt: Date
  items: ReviewLine[]
  /** Items beyond the cap (shown as "+N more"). */
  more: number
}

export interface ReviewResult {
  review: AgendaReviewData | null
  /** Why there is no block (for the admin preview). */
  skipped?: ReviewSkip
  /** Items dropped by the blocked-term filter. */
  filteredOut: number
}

/** A stored item at its stored position (the position is how its status view is found). */
interface StoredItem {
  text: string
  owner: string | null
}

export interface LastCallForReview {
  id: string
  startedAt: Date
  actionItems: unknown
  /** One entry per stored item, null where the entry is not a usable item (keeps positions aligned with the views). */
  items: Array<StoredItem | null>
  redactionsStale: boolean
  redactedNames: string[]
}

export function readStoredItems(raw: unknown): Array<StoredItem | null> {
  if (!Array.isArray(raw)) return []
  return raw.map((it) => {
    if (typeof it === 'string') return it.trim() ? { text: it, owner: null } : null
    if (it && typeof it === 'object' && typeof (it as { text?: unknown }).text === 'string' && (it as { text: string }).text.trim()) {
      const o = (it as { owner?: unknown }).owner
      return { text: (it as { text: string }).text, owner: typeof o === 'string' && o.trim() ? o : null }
    }
    return null
  })
}

/** The crew's latest published call (done items count, unlike the old agenda follow-ups) that has any action item and started before `before`. */
export async function lastCallForReview(crewId: string, o: { before: Date }): Promise<LastCallForReview | null> {
  const withImported = await importedAllowed('calls.importedAgendaContext')
  const rows = await prisma.callRecording.findMany({
    where: { crewId, status: 'PUBLISHED', startedAt: { lt: o.before }, ...(withImported ? {} : DISCORD_ONLY) },
    orderBy: { startedAt: 'desc' },
    take: 3,
    select: { id: true, startedAt: true, actionItems: true, redactionsUpdatedAt: true, summaryGeneratedAt: true, summaryEditedAt: true, redactedSpeakerIds: true },
  })
  for (const r of rows) {
    const items = readStoredItems(r.actionItems)
    if (!items.some(Boolean)) continue
    return {
      id: r.id,
      startedAt: r.startedAt,
      actionItems: r.actionItems,
      items,
      redactionsStale: redactionsNewerThanSummary(r),
      redactedNames: await redactedSpeakerNames(r.id, r.redactedSpeakerIds),
    }
  }
  return null
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
const STATE_ORDER = { none: 0, in_progress: 1, done: 2 } as const

/** Pure: the lines of the block, in stored order or (openFirst) not started, in progress, done. Items with a blocked term are dropped and counted. */
export function buildReviewItems(
  items: ReadonlyArray<StoredItem | null>,
  views: readonly ActionView[],
  o: { filter: PostFilter; redactedNames: readonly string[]; chars: number; openFirst: boolean },
): { lines: ReviewLine[]; filteredOut: number } {
  const redacted = new Set(o.redactedNames.map(norm).filter(Boolean))
  let filteredOut = 0
  const kept: Array<{ order: number; idx: number; line: ReviewLine }> = []
  items.forEach((it, idx) => {
    if (!it) return
    if (mentionsBlockedTerm(it.text, o.filter) || mentionsBlockedTerm(it.owner, o.filter)) {
      filteredOut++
      return
    }
    const view = views[idx]
    const state = view?.state ?? null
    const owner = it.owner && !redacted.has(norm(it.owner)) ? clipTo(it.owner, OWNER_CHARS) : ''
    const first = state === 'done' ? view?.links.find((l) => l.url.length <= MAX_LINK_URL) : undefined
    kept.push({
      order: o.openFirst ? STATE_ORDER[state ?? 'none'] : 0,
      idx,
      line: {
        marker: state === 'done' ? '✅' : state === 'in_progress' ? '🔄' : '-',
        text: `${clipTo(it.text, o.chars)}${owner ? ` (owner: ${owner})` : ''}`,
        ...(first ? { link: maskedLink(first) } : {}),
      },
    })
  })
  kept.sort((a, b) => a.order - b.order || a.idx - b.idx)
  return { lines: kept.map((k) => k.line), filteredOut }
}

/** The block for one crew. Never throws: a failure leaves the block out (the agenda still posts). */
export async function loadAgendaReview(
  crewId: string,
  o: { now: Date; eventStart: Date; filter: PostFilter; settings: Settings; chars: number },
): Promise<ReviewResult> {
  try {
    const call = await lastCallForReview(crewId, { before: o.eventStart })
    const maxAgeMs = settingInt('calls.agendaReviewMaxDays', o.settings) * DAY_MS
    if (!call || o.now.getTime() - call.startedAt.getTime() > maxAgeMs) return { review: null, skipped: 'none', filteredOut: 0 }
    // Fail closed: redactions newer than the summary may not be applied to the item text yet.
    if (call.redactionsStale) return { review: null, skipped: 'stale-redactions', filteredOut: 0 }
    const live = resolveToggle('calls.recapLiveStatusEnabled', o.settings)
    const views = live
      ? await loadActionViews({ id: call.id, actionItems: call.actionItems }, o.filter)
      : deriveActionViews(call.actionItems, [], { memberLinks: false, filter: o.filter })
    const { lines, filteredOut } = buildReviewItems(call.items, views, {
      filter: o.filter,
      redactedNames: call.redactedNames,
      chars: o.chars,
      openFirst: o.settings.get('calls.agendaReviewOpenFirst') === true,
    })
    if (!lines.length) return { review: null, skipped: 'filtered', filteredOut }
    const max = settingInt('calls.agendaReviewMaxItems', o.settings)
    return { review: { recordingId: call.id, startedAt: call.startedAt, items: lines.slice(0, max), more: Math.max(0, lines.length - max) }, filteredOut }
  } catch (err) {
    console.error('[call-agenda] review unavailable:', err instanceof Error ? err.message : err)
    return { review: null, filteredOut: 0 }
  }
}
