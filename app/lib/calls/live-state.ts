/**
 * POST /api/calls/recorder/live-state: the recorder's heartbeat for the live call view
 * (plans/live-call-view-and-attendance.md, PR 4). Sent every few seconds-to-a-minute and right away
 * on a join or leave; stored as one CallLiveSession per recorded call. No audio, no transcript.
 *
 * Fails closed: a crew excluded by the private post filter (or a filter that cannot be read) marks
 * the session hidden, and every public reader treats a hidden session as "no call live". An ended
 * session stays ended whatever a late heartbeat says.
 *
 * Keep the body shape in sync with recorder/src/live-state.ts.
 */
import { z } from 'zod'
import { prisma } from '@/app/lib/db'
import { getCrewMappings } from '@/app/lib/crew-mappings'
import { loadSettings, type Settings } from '@/app/lib/settings'
import { resolveToggle } from '@/app/lib/settings/toggles'
import { normalizeCrewId } from '@/app/lib/crew-id'
import { resolveCrewForEvent } from './crew-map'
import { isCrewExcluded, loadPostFilter, type PostFilter } from './post-filters'

const snowflake = z.string().regex(/^\d{15,25}$/)
export const MAX_LIVE_PRESENCE = 300

export const livePresenceSchema = z.object({
  discordId: snowflake,
  displayName: z.string().max(100).nullable().optional(),
  presentSec: z.number().int().min(0).max(86_400),
  inChannel: z.boolean(),
})
export type LivePresence = z.infer<typeof livePresenceSchema>

export const liveStateSchema = z.object({
  sessionId: z.string().min(1).max(120),
  eventId: z.string().max(40).nullable().optional(),
  eventName: z.string().max(200).nullable().optional(),
  channelId: z.string().max(40).nullable().optional(),
  startedAt: z.string().datetime(),
  present: z.array(livePresenceSchema).max(MAX_LIVE_PRESENCE),
  /** The first stream link the recorder found in the call chat (re-checked here). */
  streamLink: z.string().max(500).nullable().optional(),
  ended: z.boolean().optional(),
})
export type LiveStateBody = z.infer<typeof liveStateSchema>

/**
 * An X / Twitter broadcast or status link, normalized to https (x.com / twitter.com and their www and
 * mobile hosts), or null. Anything else (other hosts, http, other paths, credentials, a port) is rejected.
 */
export function normalizeStreamLink(raw: string | null | undefined): string | null {
  if (!raw) return null
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null
  if (!/^(www\.|mobile\.)?(x|twitter)\.com$/i.test(u.hostname)) return null
  const broadcast = /^\/i\/broadcasts\/[A-Za-z0-9]+\/?$/.test(u.pathname)
  const status = /^\/[A-Za-z0-9_]{1,15}\/status\/\d+\/?$/.test(u.pathname)
  if (!broadcast && !status) return null
  return `https://${u.hostname.toLowerCase()}${u.pathname}`
}

/** The first stream link in a chat message, or null. */
export function findStreamLink(text: string): string | null {
  for (const m of text.matchAll(/https?:\/\/[^\s<>()"']+/gi)) {
    const hit = normalizeStreamLink(m[0].replace(/[.,;:!?]+$/, ''))
    if (hit) return hit
  }
  return null
}

/** calls.liveStreamLinks: lower-case crew id -> link. Lines that do not parse are skipped. */
export function parseStreamLinks(raw: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of raw.split('\n')) {
    const m = /^([A-Za-z0-9_-]+)\s*=\s*(\S+)$/.exec(line.trim())
    const link = m ? normalizeStreamLink(m[2]) : null
    if (m && link) out.set(m[1].toLowerCase(), link)
  }
  return out
}

/** A session is live: not ended, not hidden, and a heartbeat within the stale window. */
export function isSessionLive(
  s: { endedAt: Date | null; hidden: boolean; lastSeenAt: Date },
  now: number,
  staleSeconds: number,
): boolean {
  return !s.endedAt && !s.hidden && now - s.lastSeenAt.getTime() <= staleSeconds * 1000
}

export interface LiveStateDeps {
  settings?: Settings
  postFilter?: () => Promise<PostFilter>
  resolveCrew?: (e: { eventId: string | null; eventName: string | null }) => Promise<{ crewId: string; crewLabel: string } | null>
  now?: () => number
  env?: Record<string, string | undefined>
}

export type LiveStateOutcome = 'off' | 'ok' | 'ended'

async function defaultResolveCrew(e: { eventId: string | null; eventName: string | null }) {
  const { crews } = await getCrewMappings()
  return resolveCrewForEvent(
    crews.map((c) => ({ id: c.id, label: c.label, event: c.event })),
    { eventId: e.eventId, eventName: e.eventName },
  )
}

/** Store one heartbeat. 'off' means the live view is switched off (the recorder stops early). */
export async function handleLiveState(body: LiveStateBody, deps: LiveStateDeps = {}): Promise<LiveStateOutcome> {
  const settings = deps.settings ?? (await loadSettings())
  if (!resolveToggle('calls.liveViewEnabled', settings, deps.env)) return 'off'
  const now = new Date((deps.now ?? Date.now)())

  const existing = await prisma.callLiveSession.findUnique({ where: { sessionId: body.sessionId } })
  if (existing?.endedAt) return 'ended'

  // The crew is resolved once, on the first heartbeat (the mapping and the filter are re-read cheaply later if it was unknown).
  let crew: { crewId: string; crewLabel: string } | null = existing?.crewId ? { crewId: existing.crewId, crewLabel: existing.crewLabel ?? existing.crewId } : null
  if (!crew) {
    try {
      crew = await (deps.resolveCrew ?? defaultResolveCrew)({ eventId: body.eventId ?? null, eventName: body.eventName ?? null })
    } catch {
      crew = null
    }
  }
  let hidden = false
  try {
    const filter = await (deps.postFilter ?? (() => loadPostFilter()))()
    hidden = isCrewExcluded({ id: crew?.crewId ?? body.eventName, label: crew?.crewLabel ?? body.eventName }, filter)
  } catch {
    hidden = true // cannot tell: never show
  }

  const seen = new Set<string>()
  const presence = body.present.filter((p) => !seen.has(p.discordId) && !!seen.add(p.discordId)).map((p) => ({
    discordId: p.discordId,
    displayName: p.displayName?.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim().slice(0, 100) || null,
    presentSec: p.presentSec,
    inChannel: p.inChannel,
  }))
  // The link the first heartbeat found stays; the later ones cannot replace it.
  const streamLink = existing?.streamLink ?? normalizeStreamLink(body.streamLink)
  const startedAt = new Date(body.startedAt)
  const data = {
    eventId: body.eventId ?? null,
    eventName: body.eventName ?? null,
    channelId: body.channelId ?? null,
    crewId: crew?.crewId ?? null,
    crewLabel: crew?.crewLabel ?? null,
    lastSeenAt: now,
    endedAt: body.ended ? now : null,
    hidden,
    streamLink,
    presence,
  }
  await prisma.callLiveSession.upsert({
    where: { sessionId: body.sessionId },
    create: { sessionId: body.sessionId, startedAt, ...data },
    update: data,
  })
  return body.ended ? 'ended' : 'ok'
}

/** The newest live session, or null. Hidden, ended and stale sessions never count. */
export async function findLiveSession(settings: Settings, now: number = Date.now()) {
  if (!resolveToggle('calls.liveViewEnabled', settings)) return null
  const stale = settings.get('calls.liveStaleSeconds')
  const rows = await prisma.callLiveSession.findMany({
    where: { endedAt: null, hidden: false, lastSeenAt: { gte: new Date(now - stale * 1000) } },
    orderBy: { startedAt: 'desc' },
    take: 1,
  })
  return rows[0] ?? null
}

/** The session's stream link: the one found in the call chat, else the crew's calls.liveStreamLinks line. */
export function streamLinkFor(s: { streamLink: string | null; crewId: string | null }, settings: Settings): string | null {
  if (s.streamLink) return s.streamLink
  if (!s.crewId) return null
  return parseStreamLinks(settings.get('calls.liveStreamLinks')).get(normalizeCrewId(s.crewId).toLowerCase()) ?? null
}
