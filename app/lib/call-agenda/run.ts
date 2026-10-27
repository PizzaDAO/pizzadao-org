/**
 * Pre-call agenda: ~30 minutes before a crew's scheduled Discord event, Metalhead
 * posts a short agenda in that crew's channel. Driven by /api/cron/call-agenda.
 *
 *  - Schedule: Discord guild scheduled events in the shared call voice channel
 *    (the same ones the recorder watches). Recurring events report their next
 *    occurrence as scheduled_start_time, so (eventId, start) is one occurrence.
 *  - Idempotency: a CallAgendaPost row (unique eventId + startsAt) is claimed
 *    BEFORE posting; a failed post releases the claim so the next run retries.
 *  - Off unless CALL_AGENDA_POST_ENABLED is "true"/"1". The admin preview works
 *    either way (it never posts).
 */
import { prisma } from '@/app/lib/db'
import { getCrewMappings, fetchOpenCrewTasks, type CrewOption } from '@/app/lib/crew-mappings'
import { resolveCrewForEvent } from '@/app/lib/calls/crew-map'
import { resolveChannelId } from '@/app/lib/discord-channels'
import { postDiscordMessage } from '@/app/lib/discord-rest'
import { SITE_URL } from '@/app/lib/site-url'
import { buildAgendaBullets, formatAgendaMessage, parseActionItems, type ActionItem, type AgendaBullet } from './rank'

const API = 'https://discord.com/api/v10'
export const DEFAULT_CALL_VOICE_CHANNEL_ID = '823956905739026442'
/** Post when the call starts within this long (cron every 10 min, so it lands 20-30 min before). */
export const POST_LEAD_MS = 30 * 60 * 1000
const SNOWFLAKE = /^\d{5,25}$/

export function callAgendaEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.CALL_AGENDA_POST_ENABLED?.trim().toLowerCase()
  return v === 'true' || v === '1'
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
  const callChannel = env.CALL_VOICE_CHANNEL_ID?.trim() || DEFAULT_CALL_VOICE_CHANNEL_ID
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
  if (SNOWFLAKE.test(v)) return v
  const link = v.match(/discord(?:app)?\.com\/channels\/\d+\/(\d+)/)
  if (link) return link[1]
  const mention = v.match(/^<#(\d+)>$/)
  if (mention) return mention[1]
  return resolveChannelId(v)
}

/** Action items of the crew's latest published call that has any. */
export async function previousActionItems(crewId: string): Promise<ActionItem[]> {
  const rows = await prisma.callRecording.findMany({
    where: { crewId, status: 'PUBLISHED' },
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
}

export function crewPageUrl(crewId: string): string {
  return `${SITE_URL}/crew/${encodeURIComponent(crewId)}`
}

/** Build the agendas for upcoming calls within `horizonMs`. Never posts. */
export async function planAgendas(o: { now?: Date; horizonMs: number; fetchImpl?: typeof fetch }): Promise<PlannedAgenda[]> {
  const now = o.now ?? new Date()
  const events = await fetchUpcomingEvents({ now, horizonMs: o.horizonMs, fetchImpl: o.fetchImpl })
  if (!events.length) return []
  const { crews } = await getCrewMappings()
  const byId = new Map<string, CrewOption>(crews.map((c) => [c.id, c]))
  const plans: PlannedAgenda[] = []
  for (const ev of events) {
    const hit = resolveCrewForEvent(crews.map((c) => ({ id: c.id, label: c.label, event: c.event })), { eventId: ev.id, eventName: ev.name })
    const crew = hit ? byId.get(hit.crewId) : undefined
    if (!crew) continue
    const [tasks, actionItems, posted] = await Promise.all([
      crew.sheet ? fetchOpenCrewTasks(crew.sheet) : Promise.resolve([]),
      previousActionItems(crew.id).catch(() => []),
      prisma.callAgendaPost.findUnique({ where: { eventId_startsAt: { eventId: ev.id, startsAt: ev.startsAt } }, select: { id: true } }),
    ])
    const bullets = buildAgendaBullets({ tasks, actionItems, now })
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
    })
  }
  return plans
}

export type AgendaOutcome = { eventId: string; crewId: string; status: 'posted' | 'already-posted' | 'no-items' | 'no-channel' | 'failed'; messageId?: string | null }

export interface RunResult {
  status: 'disabled' | 'ran'
  outcomes: AgendaOutcome[]
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002'
}

export async function runCallAgenda(o: { now?: Date; fetchImpl?: typeof fetch } = {}): Promise<RunResult> {
  if (!callAgendaEnabled()) return { status: 'disabled', outcomes: [] }
  const token = process.env.DISCORD_BOT_TOKEN?.trim() ?? ''
  const plans = await planAgendas({ now: o.now, horizonMs: POST_LEAD_MS, fetchImpl: o.fetchImpl })
  const outcomes: AgendaOutcome[] = []
  for (const p of plans) {
    const base = { eventId: p.eventId, crewId: p.crewId }
    if (p.alreadyPosted) {
      outcomes.push({ ...base, status: 'already-posted' })
      continue
    }
    // Nothing urgent: say nothing rather than post filler. Not recorded, so it is re-checked next run.
    if (p.bullets.length === 0) {
      outcomes.push({ ...base, status: 'no-items' })
      continue
    }
    const channelId = await resolveCrewChannel(p.channelRaw ?? undefined)
    if (!channelId) {
      outcomes.push({ ...base, status: 'no-channel' })
      continue
    }
    // Claim first: concurrent or repeated runs lose the unique constraint and skip.
    try {
      await prisma.callAgendaPost.create({ data: { eventId: p.eventId, startsAt: p.startsAt, crewId: p.crewId, channelId } })
    } catch (err) {
      if (isUniqueViolation(err)) {
        outcomes.push({ ...base, status: 'already-posted' })
        continue
      }
      throw err
    }
    try {
      const { id } = await postDiscordMessage(
        { kind: 'bot', channelId, botToken: token },
        { content: p.message, allowed_mentions: { parse: [] } },
      )
      await prisma.callAgendaPost.update({ where: { eventId_startsAt: { eventId: p.eventId, startsAt: p.startsAt } }, data: { messageId: id } }).catch(() => {})
      outcomes.push({ ...base, status: 'posted', messageId: id })
    } catch (err) {
      console.error('[call-agenda] post failed', p.eventId, err instanceof Error ? err.message : err)
      await prisma.callAgendaPost.delete({ where: { eventId_startsAt: { eventId: p.eventId, startsAt: p.startsAt } } }).catch(() => {})
      outcomes.push({ ...base, status: 'failed' })
    }
  }
  return { status: 'ran', outcomes }
}
