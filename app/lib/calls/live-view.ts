/**
 * What /calls/live shows, as two payloads:
 *  - publicLiveView: title, crew, start time, stream link and head count. No names, nothing else
 *    (CDN cached ~10 s by the route).
 *  - memberLiveView: for a signed-in member (never cached): who is present (linked to profiles), the
 *    live action items since a cursor (gated by calls.actionItemsMinLevel, with who suggested each),
 *    and the live Q&A and polls. There is no live transcript.
 */
import { prisma } from '@/app/lib/db'
import type { Settings } from '@/app/lib/settings'
import { findLiveSession, streamLinkFor, type LivePresence } from './live-state'
import { liveAccess } from './live-access'
import { personRef, resolveMemberIds, type PersonRef } from './live-members'
import { memberQaView, type PollView, type QuestionView } from './live-qa'
import { loadPostFilter, mentionsBlockedTerm, type PostFilter } from './post-filters'
import { cleanSuggestedBy } from './summarize'

export interface PublicLive {
  title: string | null
  crewLabel: string | null
  startedAt: string
  streamLink: string | null
  presentCount: number
}

type Session = NonNullable<Awaited<ReturnType<typeof findLiveSession>>>

const presenceOf = (s: Session): LivePresence[] => (Array.isArray(s.presence) ? (s.presence as unknown as LivePresence[]) : [])

function publicFields(s: Session, settings: Settings): PublicLive {
  return {
    title: s.eventName ?? s.crewLabel ?? null,
    crewLabel: s.crewLabel ?? null,
    startedAt: s.startedAt.toISOString(),
    streamLink: streamLinkFor(s, settings),
    presentCount: presenceOf(s).filter((p) => p.inChannel).length,
  }
}

export async function publicLiveView(settings: Settings, now: number = Date.now()): Promise<{ live: PublicLive | null; pollSeconds: number }> {
  const pollSeconds = settings.get('calls.livePollSeconds')
  if (settings.readFailed) return { live: null, pollSeconds }
  const s = await findLiveSession(settings, now)
  return { live: s ? publicFields(s, settings) : null, pollSeconds }
}

export interface LiveItemView {
  id: string
  text: string
  owner: string | null
  suggestedBy: PersonRef | null
  source: string
  createdAt: string
}

export interface MemberLive {
  pollSeconds: number
  live: (PublicLive & { present: Array<PersonRef & { minutes: number }> }) | null
  isHost: boolean
  items: LiveItemView[]
  /** Pass back as `itemsAfter` to get only newer items. */
  itemsCursor: number
  /** Set (the level needed) when the action items are locked for this member. */
  itemsLocked: number | null
  questions: QuestionView[]
  polls: PollView[]
}

const EMPTY: MemberLive = { pollSeconds: 10, live: null, isHost: false, items: [], itemsCursor: 0, itemsLocked: null, questions: [], polls: [] }
const MAX_ITEMS = 100

export interface MemberViewDeps {
  now?: number
  postFilter?: () => Promise<PostFilter>
}

export async function memberLiveView(
  settings: Settings,
  who: { discordId: string },
  itemsAfter: number | null,
  deps: MemberViewDeps = {},
): Promise<MemberLive> {
  const now = deps.now ?? Date.now()
  const pollSeconds = settings.get('calls.livePollSeconds')
  if (settings.readFailed) return { ...EMPTY, pollSeconds }
  const s = await findLiveSession(settings, now)
  if (!s) return { ...EMPTY, pollSeconds, itemsCursor: itemsAfter ?? 0 }
  const access = await liveAccess(who.discordId, now)
  const presence = presenceOf(s)
  const names = new Map(presence.map((p) => [p.discordId, p.displayName ?? null]))

  let items: LiveItemView[] = []
  let cursor = itemsAfter ?? 0
  if (access.actionItems.visible) {
    let filter: PostFilter | null = null
    try {
      filter = await (deps.postFilter ?? (() => loadPostFilter()))()
    } catch {
      filter = null // cannot check the private filter: show no items
    }
    if (filter) {
      const rows = await prisma.callLiveItem.findMany({
        where: { sessionId: s.sessionId, ...(itemsAfter ? { createdAt: { gt: new Date(itemsAfter) } } : {}) },
        orderBy: { createdAt: 'asc' },
        take: MAX_ITEMS,
      })
      const shown = rows.filter((r) => !mentionsBlockedTerm(r.text, filter) && !mentionsBlockedTerm(r.owner, filter))
      const members = await resolveMemberIds(shown.map((r) => r.speakerIds[0]).filter(Boolean))
      items = shown.map((r) => {
        const first = r.speakerIds[0]
        // Same rule as the published suggestedBy: the first speaker's name; "Speaker N" is never shown.
        const name = cleanSuggestedBy(first ? names.get(first) ?? null : null)
        return {
          id: r.id,
          text: r.text,
          owner: r.owner,
          suggestedBy: name ? personRef(name, first, members) : null,
          source: r.source,
          createdAt: r.createdAt.toISOString(),
        }
      })
      // The cursor moves past everything read (also the filtered ones), so they are not asked for again.
      if (rows.length) cursor = Math.max(cursor, ...rows.map((r) => r.createdAt.getTime()))
    }
  }

  const present = presence.filter((p) => p.inChannel)
  const members = await resolveMemberIds(present.map((p) => p.discordId))
  const qa = await memberQaView(s.sessionId, { discordId: who.discordId, host: access.host }).catch(() => ({ questions: [], polls: [] }))
  return {
    pollSeconds,
    live: {
      ...publicFields(s, settings),
      present: present
        .map((p) => ({ ...personRef(p.displayName, p.discordId, members), minutes: Math.floor(p.presentSec / 60) }))
        .sort((a, b) => b.minutes - a.minutes || (a.name ?? '').localeCompare(b.name ?? '')),
    },
    isHost: access.host,
    items,
    itemsCursor: cursor,
    itemsLocked: access.actionItems.visible ? null : access.actionItems.minLevel,
    questions: qa.questions,
    polls: qa.polls,
  }
}
