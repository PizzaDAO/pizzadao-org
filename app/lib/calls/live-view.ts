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
import { personRef, resolveMemberIds, resolveMemberNames, type PersonRef } from './live-members'
import { memberQaView, SHARED_VIEW_TTL_MS, type PollView, type QuestionView } from './live-qa'
import { isCrewExcluded, loadPostFilter, mentionsBlockedTerm, type PostFilter } from './post-filters'
import { cleanSuggestedBy } from './summarize'
import { excludedFromSettings } from './attendance-exclude'
import { loadCrewContext, type CrewContext } from './crew-context'
import { resolvePfpUrlsAsync } from '@/app/lib/pfp'

export interface PublicLive {
  /** The recorder session id: actions and cursors name the call they are for. */
  sessionId: string
  title: string | null
  crewLabel: string | null
  startedAt: string
  streamLink: string | null
  presentCount: number
  /** The crew's id (the crew page is /crew/<crewId>); null for a call with no crew. */
  crewId: string | null
}

type Session = Awaited<ReturnType<typeof findLiveSessions>>[number]

const presenceOf = (s: Session): LivePresence[] => (Array.isArray(s.presence) ? (s.presence as unknown as LivePresence[]) : [])

function publicFields(s: Session, settings: Settings, excluded: ReadonlySet<string> = excludedFromSettings(settings)): PublicLive {
  return {
    sessionId: s.sessionId,
    title: s.eventName ?? s.crewLabel ?? null,
    crewLabel: s.crewLabel ?? null,
    startedAt: s.startedAt.toISOString(),
    streamLink: streamLinkFor(s, settings),
    presentCount: presenceOf(s).filter((p) => p.inChannel && !excluded.has(p.discordId)).length,
    crewId: s.crewId ?? null,
  }
}

export async function publicLiveView(settings: Settings, now: number = Date.now()): Promise<{ calls: PublicLive[]; pollSeconds: number }> {
  const pollSeconds = settings.get('calls.livePollSeconds')
  if (settings.readFailed) return { calls: [], pollSeconds }
  const sessions = await findLiveSessions(settings, now)
  const excluded = excludedFromSettings(settings)
  return { calls: sessions.map((s) => publicFields(s, settings, excluded)), pollSeconds }
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
  present: Array<PersonRef & { minutes: number; pfpUrl: string | null }>
  items: LiveItemView[]
  /** What the crew is working on (goals, open tasks, leads, link); null for a call with no crew. */
  crew: CrewContext | null
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
  present: Array<PersonRef & { minutes: number; pfpUrl: string | null }>
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

async function buildShared(s: Session, filter: PostFilter | null, excluded: ReadonlySet<string>): Promise<SharedCall> {
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
  // Still no name for a speaker (left early, no heartbeat name): use the member's name.
  const stillUnnamed = rows.map((r) => r.speakerIds[0]).filter((id): id is string => !!id && !cleanSuggestedBy(names.get(id) ?? null))
  if (stillUnnamed.length) for (const [id, n] of await resolveMemberNames(stillUnnamed)) names.set(id, n)
  const inChannel = presence.filter((p) => p.inChannel && !excluded.has(p.discordId))
  const members = await resolveMemberIds([...rows.map((r) => r.speakerIds[0]).filter(Boolean), ...inChannel.map((p) => p.discordId)])
  const memberIds = [...new Set(inChannel.map((p) => members.get(p.discordId)).filter((m): m is string => !!m))]
  const pfps = memberIds.length ? await resolvePfpUrlsAsync(memberIds).catch(() => ({}) as Record<string, string | null>) : {}
  return {
    items: rows.map((r) => {
      // One known speaker is credited; several (unclear who) or none leave it empty. "Speaker N" is never shown.
      const first = r.speakerIds.length === 1 ? r.speakerIds[0] : undefined
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
      .map((p) => {
        const ref = personRef(p.displayName, p.discordId, members)
        return { ...ref, minutes: Math.floor(p.presentSec / 60), pfpUrl: (ref.memberId && pfps[ref.memberId]) || null }
      })
      .sort((a, b) => b.minutes - a.minutes || (a.name ?? '').localeCompare(b.name ?? '')),
  }
}

function sharedFor(s: Session, filter: PostFilter | null, excluded: ReadonlySet<string>, now: number): Promise<SharedCall> {
  const hit = sharedCache.get(s.sessionId)
  if (hit && now - hit.at < SHARED_VIEW_TTL_MS) return hit.value
  const value = buildShared(s, filter, excluded)
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

  const excluded = excludedFromSettings(settings)
  const calls = await Promise.all(
    sessions.map(async (s): Promise<MemberCall> => {
      const sh = await sharedFor(s, filter, excluded, now)
      // No crew context for a crew the private post filter excludes, or when the filter cannot be read.
      const crew = s.crewId && filter && !isCrewExcluded({ id: s.crewId, label: s.crewLabel }, filter) ? await loadCrewContext(s.crewId, s.crewLabel ?? s.crewId, settings, now).catch(() => null) : null
      const cur = parseCursor(cursors.get(s.sessionId))
      const canSeeItems = access.actionItems.visible && !!filter
      const fresh = canSeeItems
        ? sh.items.filter((i) => !cur || i.ms > cur.ms || (i.ms === cur.ms && i.id > cur.id))
        : []
      // The cursor moves to the newest item read (by time, then id); without new items it stays.
      const last = fresh.at(-1)
      const qa = filter ? await memberQaView(s.sessionId, { discordId: who.discordId, host: access.host }, filter, now).catch(() => ({ questions: [], polls: [] })) : { questions: [], polls: [] }
      return {
        ...publicFields(s, settings, excluded),
        present: sh.present,
        crew,
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
