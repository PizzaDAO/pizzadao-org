/**
 * The call welcome: Metalhead posts it in the call's voice channel chat, once per call occurrence,
 * once the X stream is live.
 *
 *   recorder heartbeat -> welcomeOrderForSession -> { content } in the heartbeat answer
 *     -> the recorder posts it in the voice channel chat (recorder/src/live-state.ts)
 *
 * The app decides (switch, which calls, wait for the stream link, fallback, template); the recorder
 * only posts what it is handed. Idempotent across recorder restarts: a CallWelcome row keyed by the
 * call occurrence is the claim; the recorder reports a failed post (`welcomeFailed`) to release it.
 *
 * Waiting: until a stream link is set (live page, /live, or a link posted in the call chat) nothing
 * is handed out. After calls.startWelcomeWaitMinutes without one the welcome goes out without the
 * streaming sentence, or not at all when calls.startWelcomeWithoutStream is off.
 *
 * Everything tunable is a setting (calls.welcome*). Only a production deploy ever hands one out
 * (previews share the database). Never throws.
 */
import { prisma } from '@/app/lib/db'
import { loadSettings, type Settings } from '@/app/lib/settings'
import { resolveToggle } from '@/app/lib/settings/toggles'
import { normalizeCrewId } from '@/app/lib/crew-id'
import { getCrewMappings } from '@/app/lib/crew-mappings'
import { liveAnnounceMayPost, occurrenceKey, renderTemplate } from './live-announce'
import { streamLinkFor } from './live-state'

type Env = Record<string, string | undefined>

/** The agenda lookup may take this long; past it the welcome goes out without the agenda sentence. */
export const AGENDA_TIMEOUT_MS = 1000

/** A welcome is not handed out for a session older than this (the switch was flipped mid-call, or a stuck session). */
export const WELCOME_MAX_SESSION_AGE_MS = 3 * 3_600_000

export interface WelcomeSession {
  sessionId: string
  eventId: string | null
  eventName: string | null
  channelId: string | null
  crewId: string | null
  crewLabel: string | null
  hidden: boolean
  endedAt: Date | null
  startedAt: Date
  streamLink: string | null
  streamLinkOverride?: string | null
  /** A broadcast link a host posted in the call chat (verified by the app on the heartbeat). */
  welcomeStreamLink?: string | null
}

/** "November 15, 2026" in the time zone the calls run in. */
export function welcomeDate(d: Date, env: Env = process.env): string {
  const timeZone = env.ANNOUNCE_TIMEZONE?.trim() || 'America/New_York'
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'long', day: 'numeric' }).format(d)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

/** A link that is safe inside a Discord masked link `[text](<url>)`: https, no whitespace or angle brackets. */
export function safeHttpsUrl(raw: string | null | undefined): string {
  const v = (raw ?? '').trim()
  if (!v || /[\s<>]/.test(v)) return ''
  try {
    return new URL(v).protocol === 'https:' ? v : ''
  } catch {
    return ''
  }
}

/**
 * The welcome text. A sentence whose placeholder is empty is dropped (put it in [[ ]]), and no
 * `{placeholder}` is ever left in the output. Empty result = nothing to post.
 */
export function renderWelcome(template: string, vars: { date: string; call: string; agenda: string; stream: string }): string {
  const out = renderTemplate(template, vars)
  return out.replace(/\{\w+\}/g, '').replace(/[ \t]{2,}/g, ' ').trim()
}

export interface WelcomeStore {
  /** Create the claim; false when it already exists. */
  claim(key: string, sessionId: string): Promise<boolean>
  release(key: string): Promise<void>
  /** Whether the occurrence already has a claim (a cheap read, before any slow lookup). */
  exists(key: string): Promise<boolean>
}

export const prismaWelcomeStore: WelcomeStore = {
  async claim(key, sessionId) {
    try {
      await prisma.callWelcome.create({ data: { occurrenceKey: key, sessionId } })
      return true
    } catch (err) {
      if ((err as { code?: string } | null)?.code === 'P2002') return false
      throw err
    }
  },
  async exists(key) {
    return !!(await prisma.callWelcome.findUnique({ where: { occurrenceKey: key }, select: { occurrenceKey: true } }))
  },
  async release(key) {
    await prisma.callWelcome.deleteMany({ where: { occurrenceKey: key } })
  },
}

export interface WelcomeDeps {
  store?: WelcomeStore
  settings?: Settings
  env?: Env
  now?: () => Date
  /** The call's agenda link (its crew's sheet), by crew id. */
  agendaFor?: (crewId: string | null) => Promise<string>
  /** The Discord event of the call channel, for a session whose recorder did not report an event id. */
  resolveEvent?: (channelId: string) => Promise<{ id: string; startsAt: Date } | null>
}

async function defaultAgendaFor(crewId: string | null): Promise<string> {
  if (!crewId) return ''
  const { crews } = await getCrewMappings(false, { staleWhileRevalidate: true })
  const want = normalizeCrewId(crewId)
  return safeHttpsUrl(crews.find((c) => normalizeCrewId(c.id) === want)?.sheet)
}

/**
 * The occurrence key and the instant that picks the local day: the call's Discord event (its scheduled
 * start, as the "we're live" announcement does) when it can be found, else the session.
 */
async function occurrenceFor(s: WelcomeSession, deps: WelcomeDeps, env: Env): Promise<{ key: string | null; dayAt: Date }> {
  let eventId = s.eventId
  let dayAt = s.startedAt
  if (s.channelId && deps.resolveEvent) {
    const ev = await deps.resolveEvent(s.channelId).catch(() => null)
    if (ev && (!eventId || ev.id === eventId)) {
      eventId = ev.id
      dayAt = ev.startsAt
    }
  }
  return { key: occurrenceKey({ eventId, sessionId: s.sessionId, startedAt: s.startedAt, dayAt }, env), dayAt }
}

/** The welcome to post for this heartbeat, or null (not due, not wanted, or already handed out). */
export async function welcomeOrderForSession(s: WelcomeSession | null, deps: WelcomeDeps = {}): Promise<{ content: string } | null> {
  try {
    if (!s || s.hidden || s.endedAt) return null
    const env = deps.env ?? process.env
    if (!liveAnnounceMayPost(env)) return null
    const settings = deps.settings ?? (await loadSettings())
    if (!resolveToggle('calls.startWelcomeEnabled', settings, env)) return null
    const crews = (settings.get('calls.startWelcomeCrews') as string[]).map((c) => normalizeCrewId(c))
    if (!s.crewId || !crews.includes(normalizeCrewId(s.crewId))) return null

    const now = (deps.now ?? (() => new Date()))()
    const age = now.getTime() - s.startedAt.getTime()
    if (age > WELCOME_MAX_SESSION_AGE_MS) return null

    // "The stream is live" means a host set the link: the page / /live override, or a broadcast link a host
    // posted in the chat. A member's link, or the crew's standing link, never starts the welcome.
    const hostLink = s.streamLinkOverride || s.welcomeStreamLink || ''
    let stream = hostLink
    if (!hostLink) {
      const waitMs = (settings.get('calls.startWelcomeWaitMinutes') as number) * 60_000
      if (age < waitMs) return null // still waiting for a host's stream link
      if (!resolveToggle('calls.startWelcomeWithoutStream', settings, env)) return null
      stream = streamLinkFor(s, settings) ?? '' // fallback only: any link we know may fill {stream}
    }

    const store = deps.store ?? prismaWelcomeStore
    const { key, dayAt } = await occurrenceFor(s, deps, env)
    if (!key) return null
    if (await store.exists(key)) return null // already handed out: no slow lookups on every heartbeat

    let timer: NodeJS.Timeout | undefined
    const agenda = await Promise.race([
      (deps.agendaFor ?? defaultAgendaFor)(s.crewId).catch(() => ''),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve(''), AGENDA_TIMEOUT_MS)
      }),
    ])
    if (timer) clearTimeout(timer)
    const content = renderWelcome(settings.get('calls.startWelcomeTemplate') as string, {
      date: welcomeDate(dayAt, env),
      call: (s.crewLabel ?? s.eventName ?? '').trim(),
      agenda,
      stream,
    })
    if (!content) return null

    if (!(await store.claim(key, s.sessionId))) return null
    return { content }
  } catch (err) {
    console.error('[welcome] failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/** The recorder could not post the welcome: free the claim so a later heartbeat hands it out again. Never throws. */
export async function releaseWelcomeForSession(s: WelcomeSession | null, deps: WelcomeDeps = {}): Promise<void> {
  try {
    if (!s) return
    const { key } = await occurrenceFor(s, deps, deps.env ?? process.env)
    if (key) await (deps.store ?? prismaWelcomeStore).release(key)
  } catch (err) {
    console.error('[welcome] release failed:', err instanceof Error ? err.message : err)
  }
}

/** The route hook: load the session and decide. */
export async function welcomeForSessionId(sessionId: string, o: { failed?: boolean; deps?: WelcomeDeps } = {}): Promise<{ content: string } | null> {
  try {
    const s = await prisma.callLiveSession.findUnique({ where: { sessionId } })
    const { resolveSessionEvent } = await import('./live-announce-command')
    const deps = { resolveEvent: resolveSessionEvent, ...o.deps }
    if (o.failed) await releaseWelcomeForSession(s, deps)
    return await welcomeOrderForSession(s, deps)
  } catch (err) {
    console.error('[welcome] failed:', err instanceof Error ? err.message : err)
    return null
  }
}
