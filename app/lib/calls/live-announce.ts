/**
 * "We're live" announcements for the Community Call (the manual run-of-show, automated).
 *
 *   /live (hosts, admins, live host roles)  or  the recorder starting on the Community Call (auto)
 *     -> one Discord message in calls.liveAnnounceChannelId (template calls.liveAnnounceDiscordTemplate)
 *     -> Telegram posts through the city mirror outbox (kind 'live')
 *     -> the X post text, returned to the host to copy (nothing is posted to X)
 *   N minutes later (calls.liveReminderMinutes) -> a second Telegram nudge (kind 'liverem').
 *
 * Idempotent per call occurrence: a CallLiveAnnounce row is the claim (primary key = the occurrence
 * key), the Telegram rows are unique per (kind, occurrence, city), and the reminder is claimed with a
 * conditional update. A second /live only adds a stream link (editing the Discord message).
 *
 * Switches (all off by default, each with an env kill switch): calls.liveAnnounceCommandEnabled,
 * calls.liveAnnounceAutoEnabled, calls.liveReminderEnabled. Only a production deploy ever posts.
 * Templates, channel and Telegram groups are settings; nothing deployment-specific lives here.
 */
import { prisma } from '@/app/lib/db'
import { loadSettings, type Settings } from '@/app/lib/settings'
import { resolveToggle } from '@/app/lib/settings/toggles'
import { editDiscordMessage, postDiscordMessage } from '@/app/lib/discord-rest'
import { enqueueMirror, type EnqueueInput, type EnqueueResult } from '@/app/lib/telegram/city-posts'
import { normalizeStreamLink } from './live-state'
import { parseRoleLines } from './live-access'

type Env = Record<string, string | undefined>

/** The crew id the recorder maps the Community Call to (same slug the recap uses). */
export const LIVE_ANNOUNCE_CREW_ID = 'community_call'
/** The automatic post only fires for a session that started this recently (not mid-call after a toggle flip). */
export const AUTO_MAX_SESSION_AGE_MS = 20 * 60_000
/** A reminder not queued within this long after it was due is dropped (the call is over). */
export const REMINDER_GRACE_MS = 30 * 60_000

/** Only a production deploy posts (previews share the database and the bot token). */
export const liveAnnounceMayPost = (env: Env = process.env): boolean => env.VERCEL_ENV === 'production'

// ---------------------------------------------------------------------------------------------
// Templates

export interface LiveVars {
  eventLink: string
  voiceChannel: string
  streamLink: string
  date: string
}

/**
 * Fill {placeholders}. `[[ ... ]]` marks an optional part: it is dropped when any placeholder inside
 * it is empty. An empty placeholder elsewhere renders as nothing; an unknown one too.
 */
export function renderTemplate(template: string, vars: Partial<LiveVars> | Record<string, string>): string {
  const get = (name: string) => (vars as Record<string, string | undefined>)[name] ?? ''
  const fill = (t: string) => t.replace(/\{(\w+)\}/g, (_m, name: string) => get(name))
  const withOptional = template.replace(/\[\[([\s\S]*?)\]\]/g, (_m, inner: string) => {
    const names = [...inner.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
    return names.some((n) => !get(n).trim()) ? '' : inner
  })
  return fill(withOptional).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export interface LiveContext {
  eventId: string | null
  voiceChannelId: string | null
  sessionId: string | null
  startedAt: Date
  /** The instant that picks the occurrence's local day: the Discord event's scheduled start when known. */
  dayAt?: Date
}

/** A local calendar day (YYYY-MM-DD) in the time zone the calls run in (env ANNOUNCE_TIMEZONE, default US Eastern). */
export function localDay(d: Date, env: Env = process.env): string {
  const timeZone = env.ANNOUNCE_TIMEZONE?.trim() || 'America/New_York'
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

function dateText(d: Date, env: Env): string {
  const timeZone = env.ANNOUNCE_TIMEZONE?.trim() || 'America/New_York'
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', month: 'long', day: 'numeric' }).format(d)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

/**
 * One key per call occurrence. The Discord event id plus the local day when known (a recurring event
 * keeps its id), so /live and the recorder agree whichever comes first; else the recorder session.
 */
export function occurrenceKey(ctx: Pick<LiveContext, 'eventId' | 'sessionId' | 'startedAt' | 'dayAt'>, env: Env = process.env): string | null {
  if (ctx.eventId) return `${ctx.eventId}:${localDay(ctx.dayAt ?? ctx.startedAt, env)}`
  return ctx.sessionId ? `session:${ctx.sessionId}` : null
}

/** Template values. `discord` uses a channel mention for the voice channel; plain text uses its link. */
export function buildVars(
  row: { eventId: string | null; voiceChannelId: string | null; startedAt: Date; streamLink: string | null },
  flavor: 'discord' | 'plain',
  env: Env = process.env,
): LiveVars {
  const guild = env.DISCORD_GUILD_ID?.trim() ?? ''
  const channelLink = guild && row.voiceChannelId ? `https://discord.com/channels/${guild}/${row.voiceChannelId}` : ''
  const eventLink = guild && row.eventId ? `https://discord.com/events/${guild}/${row.eventId}` : channelLink
  return {
    eventLink,
    voiceChannel: row.voiceChannelId ? (flavor === 'discord' ? `<#${row.voiceChannelId}>` : channelLink) : '',
    streamLink: row.streamLink ?? '',
    date: dateText(row.startedAt, env),
  }
}

// ---------------------------------------------------------------------------------------------
// Roles

/** Who may run /live: an admin (the /add-money role set), Dread Pizza Roberts, or a calls.liveHostRoleIds role. Pure. */
export function canRunLive(
  roles: readonly string[],
  o: { isAdmin: boolean; isRoberts: boolean; hostRoleSetting: string },
): boolean {
  if (o.isAdmin || o.isRoberts) return true
  const host = parseRoleLines(o.hostRoleSetting)
  return roles.some((r) => host.includes(r))
}

// ---------------------------------------------------------------------------------------------
// Store

export interface AnnounceRow {
  occurrenceKey: string
  eventId: string | null
  sessionId: string | null
  voiceChannelId: string | null
  postedChannelId: string | null
  discordMessageId: string | null
  streamLink: string | null
  source: string
  startedAt: Date
  reminderDueAt: Date
  reminderQueuedAt: Date | null
}

export interface LiveStore {
  get(key: string): Promise<AnnounceRow | null>
  /** Create the claim row; false when it already exists. */
  claim(row: AnnounceRow): Promise<boolean>
  update(key: string, data: Partial<Pick<AnnounceRow, 'discordMessageId' | 'postedChannelId' | 'streamLink'>>): Promise<void>
  release(key: string): Promise<void>
  /** Mark the reminder queued; true only for the one caller that did it. */
  claimReminder(key: string, now: Date): Promise<boolean>
  dueReminders(now: Date, onlyKey?: string): Promise<AnnounceRow[]>
  setSessionStream(sessionId: string, link: string): Promise<void>
}

export const prismaLiveStore: LiveStore = {
  get: (key) => prisma.callLiveAnnounce.findUnique({ where: { occurrenceKey: key } }),
  async claim(row) {
    try {
      await prisma.callLiveAnnounce.create({ data: row })
      return true
    } catch (err) {
      if ((err as { code?: string } | null)?.code === 'P2002') return false
      throw err
    }
  },
  async update(key, data) {
    await prisma.callLiveAnnounce.update({ where: { occurrenceKey: key }, data })
  },
  async release(key) {
    await prisma.callLiveAnnounce.deleteMany({ where: { occurrenceKey: key, discordMessageId: null } })
  },
  async claimReminder(key, now) {
    const r = await prisma.callLiveAnnounce.updateMany({ where: { occurrenceKey: key, reminderQueuedAt: null }, data: { reminderQueuedAt: now } })
    return r.count === 1
  },
  dueReminders: (now, onlyKey) =>
    prisma.callLiveAnnounce.findMany({
      where: {
        reminderQueuedAt: null,
        reminderDueAt: { lte: now, gt: new Date(now.getTime() - REMINDER_GRACE_MS) },
        ...(onlyKey ? { occurrenceKey: onlyKey } : {}),
      },
      take: 10,
    }),
  async setSessionStream(sessionId, link) {
    await prisma.callLiveSession.updateMany({ where: { sessionId, endedAt: null }, data: { streamLinkOverride: link } })
  },
}

export interface LiveDeps {
  store?: LiveStore
  settings?: Settings
  env?: Env
  now?: () => Date
  postDiscord?: typeof postDiscordMessage
  editDiscord?: typeof editDiscordMessage
  enqueue?: (input: EnqueueInput, env?: Env) => Promise<EnqueueResult>
  /** Send what was just queued right away (the route passes processOutbox). */
  kick?: () => Promise<void>
  /** How long to wait (ms) for a concurrent winner to record its Discord message id. */
  sleep?: (ms: number) => Promise<void>
  /** The Discord event of the call channel, for a session whose recorder did not report an event id. */
  resolveEvent?: (channelId: string) => Promise<{ id: string; startsAt: Date } | null>
}

/** A live post stays queued this long after the call started (then it is dropped, not sent late). */
export const LIVE_POST_TTL_MS = 2 * 3_600_000
const WAIT_FOR_WINNER_MS = 5_000

// ---------------------------------------------------------------------------------------------
// Announce

export type LiveStatus = 'posted' | 'already' | 'edited' | 'off' | 'preview' | 'no-occurrence' | 'error'

export interface LiveResult {
  status: LiveStatus
  /** The X post text to copy (also on 'already' / 'edited' / 'preview'). */
  xText?: string
  discord?: 'posted' | 'edited' | 'no-channel' | 'no-token' | 'skipped' | 'error'
  telegram?: 'queued' | 'off' | 'none' | 'skipped'
  telegramQueued?: number
  streamLink?: string | null
  error?: string
  /** An honest caveat for the reply. */
  note?: string
}

const discordTarget = (channelId: string, env: Env) => {
  const botToken = env.DISCORD_BOT_TOKEN?.trim()
  return botToken ? { channelId, botToken } : null
}

function discordContent(settings: Settings, row: AnnounceRow, env: Env): string {
  const body = renderTemplate(settings.get('calls.liveAnnounceDiscordTemplate'), buildVars(row, 'discord', env))
  return settings.get('calls.liveAnnounceEveryone') ? `@everyone ${body}` : body
}

/**
 * Post the announcement once for this occurrence, or (when it was already posted) add the stream link.
 * `mode` picks the switch: 'command' = /live, 'auto' = the recorder start.
 */
export async function runLiveAnnounce(
  input: { mode: 'command' | 'auto'; ctx: LiveContext; streamLink?: string | null },
  deps: LiveDeps = {},
): Promise<LiveResult> {
  const env = deps.env ?? process.env
  const now = (deps.now ?? (() => new Date()))()
  const store = deps.store ?? prismaLiveStore
  const settings = deps.settings ?? (await loadSettings())
  const toggle = input.mode === 'auto' ? 'calls.liveAnnounceAutoEnabled' : 'calls.liveAnnounceCommandEnabled'
  if (!resolveToggle(toggle, settings, env)) return { status: 'off' }

  const key = occurrenceKey(input.ctx, env)
  if (!key) return { status: 'no-occurrence' }
  const stream = normalizeStreamLink(input.streamLink)
  const xFor = (r: { streamLink: string | null } & Pick<AnnounceRow, 'eventId' | 'voiceChannelId' | 'startedAt'>) =>
    renderTemplate(settings.get('calls.liveAnnounceXTemplate'), buildVars(r, 'plain', env))
  const may = liveAnnounceMayPost(env)

  const withExisting = async (existing: AnnounceRow): Promise<LiveResult> => {
    // The automatic path only fills a missing link; a host's /live link is never overwritten by it.
    if (!stream || stream === existing.streamLink || (input.mode === 'auto' && existing.streamLink)) {
      return { status: 'already', xText: xFor(existing), streamLink: existing.streamLink, discord: 'skipped', telegram: 'skipped' }
    }
    const updated = { ...existing, streamLink: stream }
    let discord: LiveResult['discord'] = 'skipped'
    if (may) {
      await store.update(key, { streamLink: stream })
      if (input.mode === 'command' && input.ctx.sessionId) await store.setSessionStream(input.ctx.sessionId, stream).catch(() => undefined)
      const t = existing.postedChannelId && existing.discordMessageId ? discordTarget(existing.postedChannelId, env) : null
      if (t && existing.discordMessageId) {
        try {
          await (deps.editDiscord ?? editDiscordMessage)(
            { channelId: t.channelId, messageId: existing.discordMessageId, botToken: t.botToken },
            { content: discordContent(settings, updated, env), allowed_mentions: { parse: [] } },
          )
          discord = 'edited'
        } catch (err) {
          discord = 'error'
          console.error('[live-announce] edit failed:', err instanceof Error ? err.message : err)
        }
      }
    }
    return { status: may ? 'edited' : 'preview', xText: xFor(updated), streamLink: stream, discord, telegram: 'skipped' }
  }

  const existing = await store.get(key)
  if (existing) return withExisting(existing)

  const row: AnnounceRow = {
    occurrenceKey: key,
    eventId: input.ctx.eventId,
    sessionId: input.ctx.sessionId,
    voiceChannelId: input.ctx.voiceChannelId,
    postedChannelId: null,
    discordMessageId: null,
    streamLink: stream,
    source: input.mode,
    startedAt: input.ctx.startedAt,
    reminderDueAt: new Date(now.getTime() + (settings.get('calls.liveReminderMinutes') as number) * 60_000),
    reminderQueuedAt: null,
  }
  // Previews never post and never write the claim.
  if (!may) return { status: 'preview', xText: xFor(row), streamLink: stream, discord: 'skipped', telegram: 'skipped' }

  if (!(await store.claim(row))) {
    // Lost the race: the winner is posting. Wait briefly for its message id, then treat it as the existing row
    // (so a stream link given here is still added by editing its message).
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
    let again = await store.get(key)
    for (let waited = 0; again && !again.discordMessageId && waited < WAIT_FOR_WINNER_MS; waited += 500) {
      await sleep(500)
      again = await store.get(key)
    }
    return withExisting(again ?? row)
  }
  if (stream && input.mode === 'command' && input.ctx.sessionId) await store.setSessionStream(input.ctx.sessionId, stream).catch(() => undefined)

  const result: LiveResult = { status: 'posted', xText: xFor(row), streamLink: stream }
  const channelId = (settings.get('calls.liveAnnounceChannelId') as string).trim()
  if (!channelId) {
    result.discord = 'no-channel'
  } else {
    const t = discordTarget(channelId, env)
    if (!t) {
      result.discord = 'no-token'
    } else {
      let sent: { id: string | null }
      try {
        sent = await (deps.postDiscord ?? postDiscordMessage)(
          { kind: 'bot', channelId: t.channelId, botToken: t.botToken },
          {
            content: discordContent(settings, row, env),
            allowed_mentions: settings.get('calls.liveAnnounceEveryone') ? { parse: ['everyone'] } : { parse: [] },
          },
        )
      } catch (err) {
        // Nothing was posted: free the claim so a retry can post (the Telegram queue is idempotent anyway).
        await store.release(key).catch(() => undefined)
        return { status: 'error', discord: 'error', error: err instanceof Error ? err.message : String(err), xText: result.xText }
      }
      result.discord = 'posted'
      // The message is out: whatever happens to the bookkeeping, the claim stays so it is never posted twice.
      try {
        await store.update(key, { postedChannelId: channelId, discordMessageId: sent.id })
      } catch (err) {
        console.error('[live-announce] posted but could not record the message id:', err instanceof Error ? err.message : err)
        result.note = 'Posted, but the message could not be recorded, so a later stream link cannot be added by editing it.'
      }
    }
  }

  const tgText = renderTemplate(settings.get('calls.liveAnnounceTelegramTemplate'), buildVars(row, 'plain', env))
  if (tgText) {
    const q = await (deps.enqueue ?? enqueueMirror)(
      { kind: 'live', sourceId: key, text: tgText, expiresAt: new Date(input.ctx.startedAt.getTime() + LIVE_POST_TTL_MS) },
      env,
    )
    result.telegramQueued = q.queued
    result.telegram = q.queued > 0 ? 'queued' : q.reason === 'no-cities' ? 'none' : 'off'
    if (q.queued > 0) await deps.kick?.().catch(() => undefined)
  } else {
    result.telegram = 'none'
  }
  return result
}

// ---------------------------------------------------------------------------------------------
// Reminder

/** Queue the due Telegram reminders (once each). Returns how many occurrences were handled. */
export async function runLiveReminders(deps: LiveDeps = {}, onlyKey?: string): Promise<number> {
  const env = deps.env ?? process.env
  const now = (deps.now ?? (() => new Date()))()
  if (!liveAnnounceMayPost(env)) return 0
  const settings = deps.settings ?? (await loadSettings())
  if (!resolveToggle('calls.liveReminderEnabled', settings, env)) return 0
  const store = deps.store ?? prismaLiveStore
  const due = await store.dueReminders(now, onlyKey)
  let handled = 0
  for (const row of due) {
    if (!(await store.claimReminder(row.occurrenceKey, now))) continue
    handled += 1
    const text = renderTemplate(settings.get('calls.liveReminderTemplate'), buildVars(row, 'plain', env))
    if (text) {
      const q = await (deps.enqueue ?? enqueueMirror)(
        { kind: 'liverem', sourceId: row.occurrenceKey, text, sendAfter: row.reminderDueAt, expiresAt: new Date(row.startedAt.getTime() + LIVE_POST_TTL_MS) },
        env,
      )
      if (q.queued > 0) await deps.kick?.().catch(() => undefined)
    }
  }
  return handled
}

// ---------------------------------------------------------------------------------------------
// Recorder tick

export interface TickSession {
  sessionId: string
  eventId: string | null
  channelId: string | null
  crewId: string | null
  hidden: boolean
  endedAt: Date | null
  startedAt: Date
  streamLink: string | null
  streamLinkOverride?: string | null
}

/**
 * Called after each recorder heartbeat (the live-session tick): the automatic announcement when the
 * Community Call starts, and the reminder when it is due. Never throws.
 */
export async function liveAnnounceTick(s: TickSession | null, deps: LiveDeps = {}): Promise<void> {
  try {
    if (!s || s.hidden || s.endedAt) return
    const env = deps.env ?? process.env
    if (!liveAnnounceMayPost(env)) return
    const settings = deps.settings ?? (await loadSettings())
    const now = (deps.now ?? (() => new Date()))()
    const isCommunity = (s.crewId ?? '').toLowerCase() === LIVE_ANNOUNCE_CREW_ID
    if (!isCommunity) return
    // A session without an event id shares the occurrence with /live through the call channel's Discord event.
    let eventId = s.eventId
    let dayAt: Date | undefined
    if (!eventId && s.channelId && deps.resolveEvent) {
      const ev = await deps.resolveEvent(s.channelId).catch(() => null)
      if (ev) {
        eventId = ev.id
        dayAt = ev.startsAt
      }
    }
    const ctx: LiveContext = { eventId, voiceChannelId: s.channelId, sessionId: s.sessionId, startedAt: s.startedAt, ...(dayAt ? { dayAt } : {}) }
    if (resolveToggle('calls.liveAnnounceAutoEnabled', settings, env) && now.getTime() - s.startedAt.getTime() <= AUTO_MAX_SESSION_AGE_MS) {
      await runLiveAnnounce({ mode: 'auto', ctx, streamLink: s.streamLinkOverride ?? s.streamLink }, { ...deps, settings, env })
    }
    const key = occurrenceKey(ctx, env)
    if (key) await runLiveReminders({ ...deps, settings, env }, key)
  } catch (err) {
    console.error('[live-announce] tick failed:', err instanceof Error ? err.message : err)
  }
}
