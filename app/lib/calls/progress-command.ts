/**
 * The /progress slash command's runtime: the real dependencies for progress-report.ts and the
 * deferred half of the command. The interaction handler answers within Discord's 3 s window with a
 * deferred, public reply (type 5); this runs afterwards (route: after()) and edits the reply in:
 *
 *   PATCH /webhooks/{application_id}/{token}/messages/@original
 */
import { prisma } from '@/app/lib/db'
import { getCrewMappings, fetchOpenCrewTasksForCrew } from '@/app/lib/crew-mappings'
import { loadPostFilter } from '@/app/lib/calls/post-filters'
import { crewPageUrl, DEFAULT_CALL_VOICE_CHANNEL_ID, previousCallWithActionItems } from '@/app/lib/call-agenda/run'
import { savedChannelId } from '@/app/lib/settings/channels'
import { loadSettings } from '@/app/lib/settings'
import { resolveToggle, toggleEnabled } from '@/app/lib/settings/toggles'
import { makeEmbed, type Embed, type EmbedAuthor } from '@/app/lib/discord-interactions/embeds'
import { buildProgressReport, type ProgressDeps, type ProgressSettings } from '@/app/lib/calls/progress-report'

const API = 'https://discord.com/api/v10'
/** A scheduled (not yet active) event counts as "the call" this long before its start and after it. */
const BEFORE_MS = 15 * 60_000
const AFTER_MS = 2 * 3_600_000

export interface ProgressJob {
  applicationId: string
  token: string
  /** The crew option the member typed, if any. */
  crew?: string
  author?: EmbedAuthor
}

/** Whether /progress answers (admin setting, env kill switch; unreadable settings: off). */
export function progressEnabled(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  return toggleEnabled('calls.progressReportEnabled', env)
}

export async function loadProgressSettings(): Promise<ProgressSettings> {
  const s = await loadSettings()
  return { maxItems: s.get('calls.progressMaxItems'), showFollowups: resolveToggle('calls.progressShowFollowups', s) }
}

/** The event in progress in the call voice channel: ACTIVE, else one scheduled around now. */
export async function currentCallEvent(o: { now?: Date; fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {}): Promise<{ id: string; name: string; startsAt: Date | null } | null> {
  const env = o.env ?? process.env
  const token = env.DISCORD_BOT_TOKEN?.trim()
  const guild = env.DISCORD_GUILD_ID?.trim()
  if (!token || !guild) return null
  const channel = (await savedChannelId('discord.callVoiceChannelId')) || env.CALL_VOICE_CHANNEL_ID?.trim() || DEFAULT_CALL_VOICE_CHANNEL_ID
  const res = await (o.fetchImpl ?? fetch)(`${API}/guilds/${guild}/scheduled-events`, {
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) return null
  const raw = (await res.json()) as Array<{ id: string; name?: string; channel_id?: string | null; status?: number; scheduled_start_time?: string }>
  const now = (o.now ?? new Date()).getTime()
  const inChannel = raw.filter((e) => e.channel_id === channel)
  const active = inChannel.find((e) => e.status === 2)
  if (active) return { id: String(active.id), name: active.name ?? '', startsAt: active.scheduled_start_time ? new Date(active.scheduled_start_time) : null }
  const near = inChannel
    .filter((e) => {
      const start = e.scheduled_start_time ? Date.parse(e.scheduled_start_time) : NaN
      return e.status === 1 && Number.isFinite(start) && start - now <= BEFORE_MS && now - start <= AFTER_MS
    })
    .sort((a, b) => Date.parse(a.scheduled_start_time!) - Date.parse(b.scheduled_start_time!))[0]
  return near ? { id: String(near.id), name: near.name ?? '', startsAt: new Date(near.scheduled_start_time!) } : null
}

export function defaultProgressDeps(fetchImpl?: typeof fetch): ProgressDeps {
  return {
    loadFilter: loadPostFilter,
    crews: async () => (await getCrewMappings()).crews,
    currentEvent: () => currentCallEvent({ fetchImpl }),
    lastCall: previousCallWithActionItems,
    followUps: (recordingId) => prisma.followUp.findMany({ where: { recordingId }, select: { ownerName: true, ask: true, status: true } }),
    openTasks: fetchOpenCrewTasksForCrew,
    now: () => new Date(),
  }
}

export function editOriginalUrl(applicationId: string, token: string): string {
  return `${API}/webhooks/${encodeURIComponent(applicationId)}/${encodeURIComponent(token)}/messages/@original`
}

async function editOriginal(job: ProgressJob, embed: Embed, fetchImpl: typeof fetch): Promise<void> {
  const res = await fetchImpl(editOriginalUrl(job.applicationId, job.token), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Discord ${res.status} editing the /progress reply`)
}

/** Build the report and edit the deferred reply. Never throws. */
export async function runProgressCommand(
  job: ProgressJob,
  deps: ProgressDeps = defaultProgressDeps(),
  settings?: ProgressSettings,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  try {
    const result = await buildProgressReport(job.crew, settings ?? (await loadProgressSettings()), deps, { crewUrl: crewPageUrl })
    const embed =
      result.kind === 'report'
        ? makeEmbed('success', result.text.split('\n')[0].replace(/\*/g, ''), result.text.split('\n').slice(1).join('\n').trim(), { author: job.author })
        : makeEmbed('error', result.text, undefined, { author: job.author })
    await editOriginal(job, embed, fetchImpl)
  } catch (err) {
    console.error('[/progress] failed:', err instanceof Error ? err.message : String(err))
    try {
      await editOriginal(job, makeEmbed('error', 'Something went wrong. Please try again.', undefined, { author: job.author }), fetchImpl)
    } catch {
      // the token may have expired; nothing more to do
    }
  }
}
