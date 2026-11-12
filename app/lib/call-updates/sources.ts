/**
 * Real dependencies for the call-updates script builder (./script.ts) and a one-call helper that
 * builds a crew's script from the saved settings. Reuses the agenda code: the last call's action
 * items, the task ranking, the private post filter and the guild's scheduled events.
 */
import { prisma } from '@/app/lib/db'
import { getCrewMappings, fetchOpenCrewTasksForCrew } from '@/app/lib/crew-mappings'
import { loadPostFilter } from '@/app/lib/calls/post-filters'
import { DISCORD_ONLY, importedAllowed } from '@/app/lib/calls/imported'
import { DEFAULT_CALL_VOICE_CHANNEL_ID } from '@/app/lib/call-agenda/run'
import { agendaLimits, type ActionItem } from '@/app/lib/call-agenda/rank'
import { savedChannelId } from '@/app/lib/settings/channels'
import { loadSettings, type Settings } from '@/app/lib/settings'
import { redactionsNewerThanSummary } from '@/app/lib/calls/recap'
import { buildUpdatesScript, updatesSettings, type LastCallData, type ScriptResult, type UpdatesDeps } from './script'

const API = 'https://discord.com/api/v10'
export const EVENT_HORIZON_MS = 7 * 24 * 3_600_000

/** Action items including the done ones (the agenda parser drops those). */
export function parseAllActionItems(raw: unknown): ActionItem[] {
  if (!Array.isArray(raw)) return []
  const out: ActionItem[] = []
  for (const it of raw) {
    if (typeof it === 'string' && it.trim()) out.push({ text: it })
    else if (it && typeof it === 'object' && typeof (it as ActionItem).text === 'string' && (it as ActionItem).text.trim()) {
      const o = (it as ActionItem).owner
      out.push({ text: (it as ActionItem).text, owner: typeof o === 'string' && o.trim() ? o : null, done: (it as ActionItem).done === true })
    }
  }
  return out
}

/** The crew's latest published call that has action items, with what the privacy rules need. */
export async function lastCallForUpdates(crewId: string): Promise<LastCallData | null> {
  const withImported = await importedAllowed('calls.importedAgendaContext')
  const rows = await prisma.callRecording.findMany({
    where: { crewId, status: 'PUBLISHED', ...(withImported ? {} : DISCORD_ONLY) },
    orderBy: { startedAt: 'desc' },
    take: 3,
    select: { id: true, startedAt: true, actionItems: true, redactionsUpdatedAt: true, summaryGeneratedAt: true, summaryEditedAt: true, redactedSpeakerIds: true },
  })
  for (const r of rows) {
    const items = parseAllActionItems(r.actionItems)
    if (!items.length) continue
    let redactedNames: string[] = []
    if (r.redactedSpeakerIds.length) {
      const speakers = await prisma.callSpeaker.findMany({
        where: { recordingId: r.id, OR: [{ discordId: { in: r.redactedSpeakerIds } }, { linkedDiscordId: { in: r.redactedSpeakerIds } }] },
        select: { displayName: true },
      })
      redactedNames = speakers.map((s) => s.displayName).filter((n): n is string => !!n)
    }
    return { items, startedAt: r.startedAt, redactionsStale: redactionsNewerThanSummary(r), redactedNames }
  }
  return null
}

export async function taskChangesSince(crewId: string, since: Date): Promise<{ done: string[]; created: string[] }> {
  const rows = await prisma.crewTask.findMany({
    where: { crewId, archived: false, OR: [{ doneAt: { gt: since } }, { createdAt: { gt: since } }] },
    orderBy: { updatedAt: 'desc' },
    take: 60,
    select: { label: true, doneAt: true, createdAt: true },
  })
  return {
    done: rows.filter((r) => r.doneAt && r.doneAt > since).map((r) => r.label),
    created: rows.filter((r) => r.createdAt > since).map((r) => r.label),
  }
}

/** Scheduled guild events in the next week that are not crew calls (those live in the call voice channel). */
export async function upcomingGuildEvents(now: Date, o: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {}): Promise<Array<{ name: string; startsAt: Date }>> {
  const env = o.env ?? process.env
  const token = env.DISCORD_BOT_TOKEN?.trim()
  const guild = env.DISCORD_GUILD_ID?.trim()
  if (!token || !guild) return []
  const callChannel = (await savedChannelId('discord.callVoiceChannelId')) || env.CALL_VOICE_CHANNEL_ID?.trim() || DEFAULT_CALL_VOICE_CHANNEL_ID
  const res = await (o.fetchImpl ?? fetch)(`${API}/guilds/${guild}/scheduled-events`, { headers: { Authorization: `Bot ${token}` }, signal: AbortSignal.timeout(5000) })
  if (!res.ok) return []
  const raw = (await res.json()) as Array<{ name?: string; channel_id?: string | null; status?: number; scheduled_start_time?: string }>
  const t0 = now.getTime()
  const out: Array<{ name: string; startsAt: Date }> = []
  for (const e of raw) {
    const startsAt = e.scheduled_start_time ? new Date(e.scheduled_start_time) : null
    if (!startsAt || Number.isNaN(startsAt.getTime()) || e.status !== 1 || e.channel_id === callChannel || !e.name) continue
    const d = startsAt.getTime() - t0
    if (d > 0 && d <= EVENT_HORIZON_MS) out.push({ name: e.name, startsAt })
  }
  return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
}

export function defaultUpdatesDeps(): UpdatesDeps {
  return {
    loadFilter: loadPostFilter,
    crews: async () => (await getCrewMappings()).crews,
    lastCall: lastCallForUpdates,
    taskChanges: taskChangesSince,
    openTasks: fetchOpenCrewTasksForCrew,
    upcomingEvents: (now) => upcomingGuildEvents(now),
    now: () => new Date(),
  }
}

/** Build a crew's script from the saved settings (never speaks, never writes). */
export async function buildCrewScript(crewId: string, settings?: Settings, deps: UpdatesDeps = defaultUpdatesDeps()): Promise<ScriptResult> {
  const s = settings ?? (await loadSettings())
  return buildUpdatesScript(crewId, updatesSettings(s, agendaLimits(s).chars), deps)
}
