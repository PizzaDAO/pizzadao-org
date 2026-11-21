/**
 * The real wiring for crew-call-start.ts: settings, crew mapping, Discord event, live sessions, the
 * claim table. Kept apart from the pure logic so that stays testable without a database.
 */
import { SITE_URL } from '@/app/lib/site-url'
import { prisma } from '@/app/lib/db'
import { loadSettings } from '@/app/lib/settings'
import { resolveToggle } from '@/app/lib/settings/toggles'
import { parseCrewVoiceChannels, VOICE_CHANNEL_ID_LINE } from '@/app/lib/settings/registry'
import { savedChannelId } from '@/app/lib/settings/channels'
import { getCrewMappings, type CrewOption } from '@/app/lib/crew-mappings'
import { normalizeCrewId } from '@/app/lib/crew-id'
import { extractEventId } from '@/app/lib/calls/crew-map'
import { DEFAULT_CALL_VOICE_CHANNEL_ID } from '@/app/lib/call-agenda/run'
import { getGuildChannels } from '@/app/lib/discord-channels'
import { crewDiscordUrl } from '@/app/lib/crew-discord-link'
import { nextCrewCall } from '@/app/lib/crew-next-call'
import { discordScheduledEventRequest, postDiscordMessage, type DiscordScheduledEventRaw } from '@/app/lib/discord-rest'
import { isCrewLead, isOnCrewRoster } from '@/app/lib/crew-leads'
import { holdsAny, resolveRoles } from '@/app/lib/mission-review-access'
import { CALL_CAPO_ROLE_IDS } from '@/app/ui/constants'
import {
  EVENT_STATUS_ACTIVE,
  EVENT_STATUS_CANCELED,
  decideCrewCallStart,
  type CrewCallSettings,
  type Decision,
  type EventLite,
  type LiveSessionLite,
  type StartDeps,
} from './crew-call-start'

export interface CrewCallContext {
  enabled: boolean
  allowCrewMembers: boolean
  crewAllowed: boolean
  settings: CrewCallSettings
  crew: CrewOption | null
}

/** The switch, the crew filter and the tunables, from one settings read. Unreadable settings: off. */
export async function loadCrewCallContext(crewId: string): Promise<CrewCallContext> {
  const s = await loadSettings()
  const id = normalizeCrewId(crewId)
  const only = s.readFailed ? [] : s.get('crewCall.crews')
  let crew: CrewOption | null = null
  try {
    crew = (await getCrewMappings()).crews.find((c) => c.id === id) ?? null
  } catch {
    crew = null
  }
  return {
    enabled: resolveToggle('crewCall.startEnabled', s) && !!crew,
    allowCrewMembers: resolveToggle('crewCall.allowCrewMembers', s),
    crewAllowed: only.length === 0 || only.includes(id),
    settings: {
      allowAdHoc: resolveToggle('crewCall.allowAdHoc', s),
      startWindowMinutes: s.get('crewCall.startWindowMinutes'),
      cooldownMinutes: s.get('crewCall.cooldownMinutes'),
      pingRole: resolveToggle('crewCall.pingRole', s),
      postTemplate: s.get('crewCall.postTemplate'),
    },
    crew,
  }
}

/** Crew lead, Pizza Capo or admin; with the setting on, anyone on the crew's roster. Fails closed. */
export async function mayStartCrewCall(discordId: string, crewId: string, allowCrewMembers: boolean): Promise<boolean> {
  if (!discordId) return false
  try {
    const { canManageCrew } = await import('@/app/lib/crew-leads')
    if (await canManageCrew(discordId, crewId)) return true
    if (await holdsAny(await resolveRoles(discordId), CALL_CAPO_ROLE_IDS)) return true
    return allowCrewMembers ? await isOnCrewRoster(discordId, crewId) : false
  } catch {
    return false
  }
}
export { isCrewLead }

function discordEnv() {
  const token = process.env.DISCORD_BOT_TOKEN?.trim() ?? ''
  const guildId = process.env.DISCORD_GUILD_ID?.trim() ?? ''
  return token && guildId ? { token, guildId } : null
}

function toEventLite(raw: DiscordScheduledEventRaw): EventLite {
  return {
    id: raw.id,
    status: raw.status ?? 1,
    scheduledStartMs: Date.parse(raw.scheduled_start_time ?? '') || 0,
    channelId: raw.channel_id ?? null,
  }
}

export interface CrewCallState {
  decision: Decision
  event: EventLite | null
  voiceChannelId: string | null
  nowMs: number
}

/** Read Discord and the database, then decide. Throws if Discord is not configured. */
export async function readCrewCallState(ctx: CrewCallContext, crewId: string, nowMs = Date.now()): Promise<CrewCallState> {
  const env = discordEnv()
  if (!env) throw new Error('Discord is not configured')
  const crew = ctx.crew!
  const eventId = extractEventId(crew.event)
  let event: EventLite | null = null
  if (eventId) {
    try {
      event = toEventLite((await discordScheduledEventRequest({ method: 'GET', guildId: env.guildId, eventId, botToken: env.token })) as DiscordScheduledEventRaw)
    } catch {
      event = null // deleted or unreadable: treated as no scheduled event
    }
  }
  const s = await loadSettings()
  const byCrew = parseCrewVoiceChannels(s.get('calls.crewVoiceChannels'))
  const fallback = (await savedChannelId('discord.callVoiceChannelId')) || process.env.CALL_VOICE_CHANNEL_ID?.trim() || DEFAULT_CALL_VOICE_CHANNEL_ID
  const voiceChannelId = event?.channelId || byCrew.get(normalizeCrewId(crewId).toLowerCase()) || fallback || null
  const allowed = s
    .get('calls.recordableVoiceChannels')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => VOICE_CHANNEL_ID_LINE.test(l))
  const recordable = allowed.length ? allowed : [fallback]

  const since = new Date(nowMs - 6 * 60 * 60 * 1000)
  const [rows, starts] = await Promise.all([
    prisma.callLiveSession.findMany({ where: { endedAt: null, lastSeenAt: { gte: since } }, take: 50 }),
    prisma.crewCallStart.findMany({ where: { createdAt: { gte: new Date(nowMs - ctx.settings.cooldownMinutes * 60_000 - 6 * 60 * 60 * 1000) } }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ])
  const live: LiveSessionLite[] = rows.map((r) => ({
    crewId: r.crewId,
    crewLabel: r.crewLabel,
    channelId: r.channelId,
    lastSeenAtMs: r.lastSeenAt.getTime(),
    endedAt: !!r.endedAt,
  }))
  const me = normalizeCrewId(crewId)
  const last = starts.find((r) => r.crewId === me)
  // An ad hoc event this crew started may still be running (its row can predate the cooldown).
  let adHocActive = false
  const adHocRow = starts.find((r) => r.crewId === me && r.adHoc && r.eventId)
  if (adHocRow?.eventId) {
    try {
      const raw = (await discordScheduledEventRequest({ method: 'GET', guildId: env.guildId, eventId: adHocRow.eventId, botToken: env.token })) as DiscordScheduledEventRaw
      adHocActive = raw.status === EVENT_STATUS_ACTIVE
    } catch {
      adHocActive = false
    }
  }
  const crewLabels = new Map((await getCrewMappings().catch(() => ({ crews: [] as CrewOption[] }))).crews.map((c) => [c.id, c.label]))
  const decision = decideCrewCallStart({
    nowMs,
    crewId: normalizeCrewId(crewId),
    event,
    voiceChannelId,
    recordable,
    live,
    adHocActive,
    recentStarts: starts.map((r) => ({ crewId: r.crewId, crewLabel: crewLabels.get(r.crewId) ?? null, channelId: r.channelId, createdAtMs: r.createdAt.getTime() })),
    lastStartMs: last?.createdAt.getTime() ?? null,
    nextCallMs: nextCrewCall(crew.callTime, new Date(nowMs))?.getTime() ?? null,
    settings: ctx.settings,
  })
  return { decision, event, voiceChannelId, nowMs }
}

export function crewCallLinks(voiceChannelId: string | null): { voiceUrl: string; liveUrl: string } {
  const guild = process.env.DISCORD_GUILD_ID?.trim() ?? ''
  return { voiceUrl: voiceChannelId && guild ? `https://discord.com/channels/${guild}/${voiceChannelId}` : '', liveUrl: `${SITE_URL}/calls/live` }
}

/** The text channel id of the crew's Channel cell, or null. */
async function crewTextChannelId(crew: CrewOption, guildId: string, token: string): Promise<string | null> {
  const channels = (await getGuildChannels({ botToken: token, guildId }).catch(() => null)) ?? undefined
  const url = crewDiscordUrl(crew.channel, guildId, channels)
  return url?.match(/\/(\d{5,25})$/)?.[1] ?? null
}

/** The crew's Discord role id when its Role cell holds one. */
export function crewRoleId(crew: CrewOption): string | null {
  return crew.role?.match(/\d{15,25}/)?.[0] ?? null
}

export function buildStartDeps(crew: CrewOption): StartDeps {
  const env = discordEnv()
  if (!env) throw new Error('Discord is not configured')
  const { token, guildId } = env
  return {
    isProduction: process.env.VERCEL_ENV === 'production',
    now: () => Date.now(),
    claim: async (row) => {
      const { reclaimOlderThanMs, ...data } = row
      try {
        await prisma.crewCallStart.create({ data })
        return { ok: true }
      } catch (e) {
        if ((e as { code?: string })?.code !== 'P2002') throw e
        if (reclaimOlderThanMs) {
          // A stale ad hoc claim (past its cooldown) is replaced; deleteMany is atomic, so one caller wins.
          const gone = await prisma.crewCallStart.deleteMany({ where: { occurrenceKey: row.occurrenceKey, createdAt: { lt: new Date(Date.now() - reclaimOlderThanMs) } } })
          if (gone.count > 0) {
            try {
              await prisma.crewCallStart.create({ data })
              return { ok: true }
            } catch (e2) {
              if ((e2 as { code?: string })?.code !== 'P2002') throw e2
            }
          }
        }
        const existing = await prisma.crewCallStart.findUnique({ where: { occurrenceKey: row.occurrenceKey } })
        return { ok: false, by: existing?.startedBy ?? '', atMs: existing?.createdAt.getTime() ?? Date.now() }
      }
    },
    release: async (occurrenceKey) => {
      await prisma.crewCallStart.deleteMany({ where: { occurrenceKey } })
    },
    annotate: async (occurrenceKey, patch) => {
      await prisma.crewCallStart.update({ where: { occurrenceKey }, data: patch })
    },
    discord: {
      setActive: async (eventId, reason) => {
        await discordScheduledEventRequest({ method: 'PATCH', guildId, eventId, botToken: token, body: { status: EVENT_STATUS_ACTIVE }, reason })
      },
      cancel: async (eventId, reason) => {
        await discordScheduledEventRequest({ method: 'PATCH', guildId, eventId, botToken: token, body: { status: EVENT_STATUS_CANCELED }, reason })
      },
      createAdHoc: async (o) => {
        const created = (await discordScheduledEventRequest({
          method: 'POST',
          guildId,
          botToken: token,
          reason: o.reason,
          body: {
            name: o.name.slice(0, 100),
            privacy_level: 2,
            entity_type: 2,
            channel_id: o.channelId,
            scheduled_start_time: new Date(o.startMs).toISOString(),
            scheduled_end_time: new Date(o.endMs).toISOString(),
          },
        })) as DiscordScheduledEventRaw
        return { id: created.id }
      },
      post: async ({ content, mentionRoleId }) => {
        const channelId = await crewTextChannelId(crew, guildId, token)
        if (!channelId) throw new Error('No crew channel')
        return postDiscordMessage(
          { kind: 'bot', channelId, botToken: token },
          { content, allowed_mentions: { parse: [], roles: mentionRoleId ? [mentionRoleId] : [] } },
        )
      },
    },
  }
}
