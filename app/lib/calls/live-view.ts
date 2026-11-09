/**
 * What /calls/live shows, as two payloads (one entry per call that is live, newest first):
 *  - publicLiveView: title, crew, start time, stream link and head count. No names, nothing else
 *    (CDN cached by the route).
 *  - memberLiveView: for a signed-in member (never cached): who is present (linked to profiles), the
 *    live action items since a cursor (gated by calls.actionItemsMinLevel, with who suggested each),
 *    and the live Q&A and polls. There is no live transcript.
 *
 * Cost: everything that does not depend on the viewer (items, names, profile ids, question and poll
 * totals) is built once per ~3 s per instance and call; a viewer adds only their own votes.
 */
import { prisma } from '@/app/lib/db'
import type { Settings } from '@/app/lib/settings'
import { findLiveSessions, streamLinkFor, type LivePresence } from './live-state'
import { liveAccess } from './live-access'
import { personRef, resolveMemberIds, type PersonRef } from './live-members'
import { memberQaView, SHARED_VIEW_TTL_MS, type PollView, type QuestionView } from './live-qa'
import { loadPostFilter, mentionsBlockedTerm, type PostFilter } from './post-filters'
import { cleanSuggestedBy } from './summarize'

export interface PublicLive {
  /** The recorder session id: actions and cursors name the call they are for. */
  sessionId: string
  title: string | null
  crewLabel: string | null
  startedAt: string
  streamLink: string | null
  presentCount: number
}

type Session = Awaited<ReturnType<typeof findLiveSessions>>[number]

const presenceOf = (s: Session): LivePresence[] => (Array.isArray(s.presence) ? (s.presence as unknown as LivePresence[]) : [])

function publicFields(s: Session, settings: Settings): PublicLive {
  return {
    sessionId: s.sessionId,
    title: s.eventName ?? s.crewLabel ?? null,
    crewLabel: s.crewLabel ?? null,
    startedAt: s.startedAt.toISOString(),
    streamLink: streamLinkFor(s, settings),
    presentCount: presenceOf(s).filter((p) => p.inChannel).length,
  }
}

export async function publicLiveView(settings: Settings, now: number = Date.now()): Promise<{ calls: PublicLive[]; pollSeconds: number }> {
  const pollSeconds = settings.get('calls.livePollSeconds')
  if (settings.readFailed) return { calls: [], pollSeconds }
  const sessions = await findLiveSessions(settings, now)
  return { calls: sessions.map((s) => publicFields(s, settings)), pollSeconds }
}

export interface LiveItemView {
  id: string
  text: string
  owner: string | null
  suggestedBy: PersonRef | null
  source: string
  createdAt: string
}

export interface MemberCall extends PublicLive {
  present: Array<PersonRef & { minutes: number }>
  items: LiveItemView[]
  /** Pass back (with the session id) to get only newer items: `<createdAt ms>~<item id>`. */
  itemsCursor: string | null
  /** Set (the level needed) when the action items are locked for this member. */
  itemsLocked: number | null
  questions: QuestionView[]
  polls: PollView[]
}

export interface MemberLive {
  pollSeconds: number
  isHost: boolean
  calls: MemberCall[]
}

// ---- the viewer-independent part, cached ~3 s ---------------------------------------------------

interface SharedItem extends LiveItemView {
  ms: number
}
interface SharedCall {
  items: SharedItem[]
  present: Array<PersonRef & { minutes: number }>
}

const sharedCache = new Map<string, { at: number; value: Promise<SharedCall> }>()
export function clearLiveViewCache(): void {
  sharedCache.clear()
}

const MAX_ITEMS = 300

export function parseCursor(raw: string | null | undefined): { ms: number; id: string } | null {
  const m = /^(\d{1,15})~([A-Za-z0-9_-]{1,40})$/.exec(raw ?? '')
  return m ? { ms: Number(m[1]), id: m[2] } : null
}

async function buildShared(s: Session, filter: PostFilter | null): Promise<SharedCall> {
  const presence = presenceOf(s)
  const names = new Map(presence.map((p) => [p.discordId, p.displayName ?? null]))
  const rows = filter
    ? (await prisma.callLiveItem.findMany({ where: { sessionId: s.sessionId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: MAX_ITEMS })).filter(
        (r) => !mentionsBlockedTerm(r.text, filter) && !mentionsBlockedTerm(r.owner, filter),
      )
    : []
  // A speaker who left or never had a name in the heartbeat: fall back to the name on their transcript lines.
  const unnamed = rows.some((r) => r.speakerIds[0] && !cleanSuggestedBy(names.get(r.speakerIds[0]) ?? null))
  if (unnamed) {
    try {
      const chunks = await prisma.callLiveChunk.findMany({ where: { sessionId: s.sessionId }, select: { segments: true }, orderBy: { seq: 'asc' } })
      for (const c of chunks) {
        for (const seg of Array.isArray(c.segments) ? (c.segments as unknown as Array<{ discordId?: string; name?: string | null }>) : []) {
          if (seg.discordId && seg.name && !cleanSuggestedBy(names.get(seg.discordId) ?? null)) names.set(seg.discordId, seg.name)
        }
      }
    } catch {
      // no fallback names
    }
  }
  const inChannel = presence.filter((p) => p.inChannel)
  const members = await resolveMemberIds([...rows.map((r) => r.speakerIds[0]).filter(Boolean), ...inChannel.map((p) => p.discordId)])
  return {
    items: rows.map((r) => {
      const first = r.speakerIds[0]
      // Same rule as the published suggestedBy: the first speaker's name; "Speaker N" is never shown.
      const name = cleanSuggestedBy(first ? names.get(first) ?? null : null)
      return {
        id: r.id,
        ms: r.createdAt.getTime(),
        text: r.text,
        owner: r.owner,
        suggestedBy: name ? personRef(name, first, members) : null,
        source: r.source,
        createdAt: r.createdAt.toISOString(),
      }
    }),
    present: inChannel
      .map((p) => ({ ...personRef(p.displayName, p.discordId, members), minutes: Math.floor(p.presentSec / 60) }))
      .sort((a, b) => b.minutes - a.minutes || (a.name ?? '').localeCompare(b.name ?? '')),
  }
}

function sharedFor(s: Session, filter: PostFilter | null, now: number): Promise<SharedCall> {
  const hit = sharedCache.get(s.sessionId)
  if (hit && now - hit.at < SHARED_VIEW_TTL_MS) return hit.value
  const value = buildShared(s, filter)
  sharedCache.set(s.sessionId, { at: now, value })
  value.catch(() => {
    if (sharedCache.get(s.sessionId)?.value === value) sharedCache.delete(s.sessionId)
  })
  if (sharedCache.size > 50) for (const k of sharedCache.keys()) if (k !== s.sessionId) sharedCache.delete(k)
  return value
}

// ---- the member payload ------------------------------------------------------------------------

export interface MemberViewDeps {
  now?: number
  postFilter?: () => Promise<PostFilter>
}

export async function memberLiveView(
  settings: Settings,
  who: { discordId: string },
  cursors: ReadonlyMap<string, string> = new Map(),
  deps: MemberViewDeps = {},
): Promise<MemberLive> {
  const now = deps.now ?? Date.now()
  const pollSeconds = settings.get('calls.livePollSeconds')
  if (settings.readFailed) return { pollSeconds, isHost: false, calls: [] }
  const sessions = await findLiveSessions(settings, now)
  if (sessions.length === 0) return { pollSeconds, isHost: false, calls: [] }
  const access = await liveAccess(who.discordId, now)
  let filter: PostFilter | null = null
  try {
    filter = await (deps.postFilter ?? (() => loadPostFilter()))()
  } catch {
    filter = null // cannot check the private filter: no items, questions or polls
  }

  const calls = await Promise.all(
    sessions.map(async (s): Promise<MemberCall> => {
      const sh = await sharedFor(s, filter, now)
      const cur = parseCursor(cursors.get(s.sessionId))
      const canSeeItems = access.actionItems.visible && !!filter
      const fresh = canSeeItems
        ? sh.items.filter((i) => !cur || i.ms > cur.ms || (i.ms === cur.ms && i.id > cur.id))
        : []
      // The cursor moves to the newest item read (by time, then id); without new items it stays.
      const last = fresh.at(-1)
      const qa = filter ? await memberQaView(s.sessionId, { discordId: who.discordId, host: access.host }, filter, now).catch(() => ({ questions: [], polls: [] })) : { questions: [], polls: [] }
      return {
        ...publicFields(s, settings),
        present: sh.present,
        items: fresh.map((i) => ({ id: i.id, text: i.text, owner: i.owner, suggestedBy: i.suggestedBy, source: i.source, createdAt: i.createdAt })),
        itemsCursor: last ? `${last.ms}~${last.id}` : (cursors.get(s.sessionId) ?? null),
        itemsLocked: access.actionItems.visible ? null : access.actionItems.minLevel,
        questions: qa.questions,
        polls: qa.polls,
      }
    }),
  )
  return { pollSeconds, isHost: access.host, calls }
}
