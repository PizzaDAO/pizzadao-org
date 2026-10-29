/**
 * Pre-call agenda: ~30 minutes before a crew's scheduled Discord event, Metalhead
 * posts a short agenda in that crew's channel. Driven by /api/cron/call-agenda.
 *
 *  - Schedule: Discord guild scheduled events in the shared call voice channel
 *    (the same ones the recorder watches). Recurring events report their next
 *    occurrence as scheduled_start_time, so (eventId, start) is one occurrence.
 *  - Idempotency: a CallAgendaPost row (unique eventId + startsAt) is claimed
 *    BEFORE posting; a failed post releases the claim so the next run retries.
 *  - Off unless calls.agendaPostEnabled is "true"/"1". The admin preview works
 *    either way (it never posts).
 */
import { prisma } from '@/app/lib/db'
import { getCrewMappings, fetchOpenCrewTasksResult, type CrewOption } from '@/app/lib/crew-mappings'
import { resolveCrewForEvent } from '@/app/lib/calls/crew-map'
import { getGuildChannels, normalizeChannelName } from '@/app/lib/discord-channels'
import { postDiscordMessage, DiscordPostError } from '@/app/lib/discord-rest'
import { isCrewExcluded, loadPostFilter, mentionsBlockedTerm, type PostFilter } from '@/app/lib/calls/post-filters'
import { SITE_URL } from '@/app/lib/site-url'
import { savedChannelId } from '@/app/lib/settings/channels'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { DISCORD_ONLY, importedAllowed } from '@/app/lib/calls/imported'
import { buildAgendaBullets, formatAgendaMessage, parseActionItems, type ActionItem, type AgendaBullet } from './rank'

const API = 'https://discord.com/api/v10'
export const DEFAULT_CALL_VOICE_CHANNEL_ID = '823956905739026442'
/** Post when the call starts within this long (cron every 10 min, so it lands 20-30 min before). */
export const POST_LEAD_MS = 30 * 60 * 1000
const SNOWFLAKE = /^\d{5,25}$/

/**
 * Whether agendas are posted: the admin setting `calls.agendaPostEnabled`, with CALL_AGENDA_POST_ENABLED
 * as the fallback while none is saved and, set to off, a kill switch. Unreadable settings: off.
 */
export function callAgendaEnabled(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  return toggleEnabled('calls.agendaPostEnabled', env)
}

export interface ScheduledEvent {
  id: string
  name: string
  channelId: string | null
  status: number // 1 SCHEDULED, 2 ACTIVE, 3 COMPLETED, 4 CANCELED
  startsAt: Date
}

/** Upcoming (SCHEDULED/ACTIVE, start after `now`, within `horizonMs`) events in the call channel. */
export async function fetchUpcomingEvents(
  o: { now: Date; horizonMs: number; fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv },
): Promise<ScheduledEvent[]> {
  const env = o.env ?? process.env
  const token = env.DISCORD_BOT_TOKEN?.trim()
  const guild = env.DISCORD_GUILD_ID?.trim()
  if (!token || !guild) throw new Error('DISCORD_BOT_TOKEN / DISCORD_GUILD_ID not configured')
  const callChannel = (await savedChannelId('discord.callVoiceChannelId')) || env.CALL_VOICE_CHANNEL_ID?.trim() || DEFAULT_CALL_VOICE_CHANNEL_ID
  const res = await (o.fetchImpl ?? fetch)(`${API}/guilds/${guild}/scheduled-events`, {
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`Discord scheduled events HTTP ${res.status}`)
  const raw = (await res.json()) as Array<{ id: string; name?: string; channel_id?: string | null; status?: number; scheduled_start_time?: string }>
  const t0 = o.now.getTime()
  const out: ScheduledEvent[] = []
  for (const e of raw) {
    const startsAt = e.scheduled_start_time ? new Date(e.scheduled_start_time) : null
    if (!startsAt || Number.isNaN(startsAt.getTime())) continue
    if (e.channel_id !== callChannel) continue
    if (e.status !== 1 && e.status !== 2) continue
    const d = startsAt.getTime() - t0
    if (d <= 0 || d > o.horizonMs) continue
    out.push({ id: String(e.id), name: e.name ?? '', channelId: e.channel_id ?? null, status: e.status, startsAt })
  }
  return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id))
}

/** A crew's text channel id from its sheet cell: bare id, discord.com/channels link, or a channel name. */
export async function resolveCrewChannel(raw: string | undefined): Promise<string | null> {
  const v = (raw ?? '').trim()
  if (!v) return null
  // Every route goes through the guild's own channel list: an id from another server (or a
  // typo) must never be claimed or posted to. Names match exactly (no suffix guessing).
  const channels = await getGuildChannels()
  if (!channels) return null
  const usable = channels.filter((c) => c.type === 0 || c.type === 5)
  const byId = (id: string) => usable.find((c) => c.id === id)?.id ?? null
  if (SNOWFLAKE.test(v)) return byId(v)
  const link = v.match(/discord(?:app)?\.com\/channels\/(\d+)\/(\d+)/)
  if (link) {
    const guild = process.env.DISCORD_GUILD_ID?.trim()
    return guild && link[1] !== guild ? null : byId(link[2])
  }
  const mention = v.match(/^<#(\d+)>$/)
  if (mention) return byId(mention[1])
  const want = normalizeChannelName(v)
  return want ? (usable.find((c) => normalizeChannelName(c.name) === want)?.id ?? null) : null
}

/** Action items of the crew's latest published call that has any. */
export async function previousActionItems(crewId: string): Promise<ActionItem[]> {
  const withImported = await importedAllowed('calls.importedAgendaContext')
  const rows = await prisma.callRecording.findMany({
    where: { crewId, status: 'PUBLISHED', ...(withImported ? {} : DISCORD_ONLY) },
    orderBy: { startedAt: 'desc' },
    take: 3,
    select: { actionItems: true },
  })
  for (const r of rows) {
    const items = parseActionItems(r.actionItems)
    if (items.length) return items
  }
  return []
}

export interface PlannedAgenda {
  eventId: string
  eventName: string
  startsAt: Date
  crewId: string
  crewLabel: string
  channelRaw: string | null
  crewUrl: string
  bullets: AgendaBullet[]
  message: string
  alreadyPosted: boolean
  /** The crew sheet could not be read (as opposed to having no urgent tasks). */
  sheetError: boolean
  /** The crew is excluded from automated posts (see calls/post-filters.ts): never posted. */
  excluded: boolean
  /** Tasks / last-call items left out of the agenda by the blocked-term filter. */
  filteredOut: number
}

/** A rescheduled event keeps its id but changes startsAt; treat a post within this of the new start as the same call. */
export const RESCHEDULE_WINDOW_MS = 6 * 60 * 60 * 1000

export function crewPageUrl(crewId: string): string {
  return `${SITE_URL}/crew/${encodeURIComponent(crewId)}`
}

/** Build the agendas for upcoming calls within `horizonMs`. Never posts. */
export async function planAgendas(o: { now?: Date; horizonMs: number; fetchImpl?: typeof fetch; filter?: PostFilter }): Promise<PlannedAgenda[]> {
  const now = o.now ?? new Date()
  // Throws when the filter cannot be read: better no agenda than an unfiltered one.
  const filter = o.filter ?? (await loadPostFilter())
  const events = await fetchUpcomingEvents({ now, horizonMs: o.horizonMs, fetchImpl: o.fetchImpl })
  if (!events.length) return []
  const { crews } = await getCrewMappings()
  const byId = new Map<string, CrewOption>(crews.map((c) => [c.id, c]))
  const plans: PlannedAgenda[] = []
  for (const ev of events) {
    const hit = resolveCrewForEvent(crews.map((c) => ({ id: c.id, label: c.label, event: c.event })), { eventId: ev.id, eventName: ev.name })
    const crew = hit ? byId.get(hit.crewId) : undefined
    if (!crew) continue
    if (isCrewExcluded(crew, filter)) {
      plans.push({
        eventId: ev.id, eventName: ev.name, startsAt: ev.startsAt, crewId: crew.id, crewLabel: crew.label,
        channelRaw: crew.channel ?? null, crewUrl: crewPageUrl(crew.id), bullets: [], message: '',
        alreadyPosted: false, sheetError: false, excluded: true, filteredOut: 0,
      })
      continue
    }
    const start = ev.startsAt.getTime()
    const [sheet, actionItems, posted] = await Promise.all([
      crew.sheet ? fetchOpenCrewTasksResult(crew.sheet) : Promise.resolve({ tasks: [], error: false }),
      previousActionItems(crew.id).catch(() => []),
      prisma.callAgendaPost.findFirst({
        where: { eventId: ev.id, startsAt: { gte: new Date(start - RESCHEDULE_WINDOW_MS), lte: new Date(start + RESCHEDULE_WINDOW_MS) } },
        select: { id: true },
      }),
    ])
    // Drop tasks / last-call items that mention a blocked term before ranking.
    const tasks = sheet.tasks.filter((t) => !mentionsBlockedTerm(t.label, filter))
    const items = actionItems.filter((a) => !mentionsBlockedTerm(a.text, filter) && !mentionsBlockedTerm(a.owner, filter))
    const filteredOut = sheet.tasks.length - tasks.length + actionItems.length - items.length
    const bullets = buildAgendaBullets({ tasks, actionItems: items, now })
    const crewUrl = crewPageUrl(crew.id)
    plans.push({
      eventId: ev.id,
      eventName: ev.name,
      startsAt: ev.startsAt,
      crewId: crew.id,
      crewLabel: crew.label,
      channelRaw: crew.channel ?? null,
      crewUrl,
      bullets,
      message: formatAgendaMessage({ crewLabel: crew.label, startsAt: ev.startsAt, bullets, crewUrl }),
      alreadyPosted: !!posted,
      sheetError: sheet.error,
      excluded: false,
      filteredOut,
    })
  }
  return plans
}

export type AgendaOutcome = {
  eventId: string
  crewId: string
  status: 'posted' | 'excluded' | 'already-posted' | 'no-items' | 'no-channel' | 'sheet-error' | 'failed' | 'post-uncertain' | 'error'
  messageId?: string | null
}

export interface RunResult {
  status: 'disabled' | 'ran'
  outcomes: AgendaOutcome[]
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002'
}

/** Discord posts we can be sure did NOT land: the claim is safe to release. 5xx / timeout / network may have posted. */
export function postDefinitelyFailed(err: unknown): boolean {
  return err instanceof DiscordPostError && [400, 403, 404, 429].includes(err.status)
}

export const POST_TIMEOUT_MS = 10_000
const SUPPRESS_EMBEDS = 4

async function processPlan(p: PlannedAgenda, token: string): Promise<AgendaOutcome> {
  const base = { eventId: p.eventId, crewId: p.crewId }
  if (p.excluded) return { ...base, status: 'excluded' }
  if (p.alreadyPosted) return { ...base, status: 'already-posted' }
  // Sheet unreadable: do not claim, so the next run retries (an empty list from a healthy sheet is 'no-items').
  if (p.sheetError) return { ...base, status: 'sheet-error' }
  // Nothing urgent: say nothing rather than post filler. Not recorded, so it is re-checked next run.
  if (p.bullets.length === 0) return { ...base, status: 'no-items' }
  const channelId = await resolveCrewChannel(p.channelRaw ?? undefined)
  if (!channelId) return { ...base, status: 'no-channel' }
  // Claim first: concurrent or repeated runs lose the unique constraint and skip.
  try {
    await prisma.callAgendaPost.create({ data: { eventId: p.eventId, startsAt: p.startsAt, crewId: p.crewId, channelId } })
  } catch (err) {
    if (isUniqueViolation(err)) return { ...base, status: 'already-posted' }
    throw err
  }
  const where = { eventId_startsAt: { eventId: p.eventId, startsAt: p.startsAt } }
  try {
    const { id } = await postDiscordMessage(
      { kind: 'bot', channelId, botToken: token },
      { content: p.message, allowed_mentions: { parse: [] }, flags: SUPPRESS_EMBEDS },
      { fetchImpl: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(POST_TIMEOUT_MS) }) },
    )
    await prisma.callAgendaPost.update({ where, data: { messageId: id } }).catch(() => {})
    return { ...base, status: 'posted', messageId: id }
  } catch (err) {
    console.error('[call-agenda] post failed', p.eventId, err instanceof Error ? err.message : err)
    if (postDefinitelyFailed(err)) {
      await prisma.callAgendaPost.delete({ where }).catch(() => {})
      return { ...base, status: 'failed' }
    }
    // The message may have been delivered; keep the claim rather than risk a double post.
    return { ...base, status: 'post-uncertain' }
  }
}

export async function runCallAgenda(o: { now?: Date; fetchImpl?: typeof fetch } = {}): Promise<RunResult> {
  if (!(await callAgendaEnabled())) return { status: 'disabled', outcomes: [] }
  const token = process.env.DISCORD_BOT_TOKEN?.trim() ?? ''
  const plans = await planAgendas({ now: o.now, horizonMs: POST_LEAD_MS, fetchImpl: o.fetchImpl })
  const outcomes: AgendaOutcome[] = []
  for (const p of plans) {
    try {
      outcomes.push(await processPlan(p, token))
    } catch (err) {
      // One crew's failure must not stop the others.
      console.error('[call-agenda] crew failed', p.crewId, err instanceof Error ? err.message : err)
      outcomes.push({ eventId: p.eventId, crewId: p.crewId, status: 'error' })
    }
  }
  return { status: 'ran', outcomes }
}
