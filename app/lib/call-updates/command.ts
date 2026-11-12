/**
 * The /metalhead slash command group (updates | stop | pause | resume | skip | script): which call it
 * means, who may use it, and the deferred half that does the work and edits the ephemeral reply in.
 * The interaction handler answers within Discord's 3 s window with a deferred ephemeral reply; this
 * runs afterwards (route: after()).
 *
 * Which call: the live call whose voice channel is the one the command was typed in (the voice
 * channel's own chat); otherwise the only live call; otherwise the optional `call` choice.
 *
 * Who: crew leads of the call's crew, guild admins and live-call hosts. With
 * calls.updatesControlAnyMember on, any signed-up member may also stop / pause / resume / skip.
 * Everything fails closed (an unreadable roster means "not a lead").
 */
import { prisma } from '@/app/lib/db'
import { normalizeCrewId } from '@/app/lib/crew-id'
import { getCrewLeadMemberIds } from '@/app/lib/crew-leads'
import { findMemberIdByDiscordId } from '@/app/lib/member-utils'
import { liveAccess } from '@/app/lib/calls/live-access'
import { loadSettings, type Settings } from '@/app/lib/settings'
import { resolveToggle, toggleEnabled } from '@/app/lib/settings/toggles'
import { makeEmbed, type Embed, type EmbedAuthor } from '@/app/lib/discord-interactions/embeds'
import { editOriginalUrl } from '@/app/lib/calls/progress-command'
import type { MetalheadJob } from '@/app/lib/discord-interactions/handle'
import { buildCrewScript } from './sources'
import { controlUpdates, defaultRunDeps, startUpdates, updatesEnabled, type CallRef, type RunDeps } from './run'

export function metalheadEnabled(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  return toggleEnabled('discord.metalheadCommandEnabled', env)
}

export interface LiveCall extends CallRef {
  crewLabel: string | null
}

/** Live calls: not ended, not hidden, heartbeat within the stale window. */
export async function liveCalls(settings: Settings, now: number = Date.now()): Promise<LiveCall[]> {
  const stale = settings.get('calls.liveStaleSeconds')
  const rows = await prisma.callLiveSession.findMany({
    where: { endedAt: null, hidden: false, lastSeenAt: { gte: new Date(now - stale * 1000) } },
    orderBy: { startedAt: 'desc' },
    take: 10,
  })
  return rows
    .filter((r) => !!r.crewId && !!r.channelId)
    .map((r) => ({ sessionId: r.sessionId, eventId: r.eventId, crewId: normalizeCrewId(r.crewId!), crewLabel: r.crewLabel, channelId: r.channelId!, startedAt: r.startedAt, hidden: r.hidden }))
}

export type Resolved = { ok: true; call: LiveCall } | { ok: false; message: string }

/** Pure: pick the call a command means. */
export function pickCall(calls: readonly LiveCall[], channelId: string | undefined, choice: string | undefined): Resolved {
  if (calls.length === 0) return { ok: false, message: 'No call is being recorded right now.' }
  const here = channelId ? calls.find((c) => c.channelId === channelId) : undefined
  if (here) return { ok: true, call: here }
  if (choice) {
    const picked = calls.find((c) => c.sessionId === choice)
    return picked ? { ok: true, call: picked } : { ok: false, message: 'That call is not live any more.' }
  }
  if (calls.length === 1) return { ok: true, call: calls[0] }
  return { ok: false, message: 'More than one call is live. Use this in the call\'s voice channel chat, or pick the call.' }
}

export type MayResult = boolean

/** Whether this member may run `sub` for the call's crew. Fails closed. */
export async function mayRun(
  sub: MetalheadJob['sub'],
  who: { discordId: string; admin: boolean },
  crewId: string,
  settings: Settings,
  deps: { isLead?: (discordId: string, crewId: string) => Promise<boolean>; isHost?: (discordId: string) => Promise<boolean>; isMember?: (discordId: string) => Promise<boolean>; env?: Record<string, string | undefined> } = {},
): Promise<MayResult> {
  if (who.admin) return true
  const isLead =
    deps.isLead ??
    (async (id: string, crew: string) => {
      const memberId = await findMemberIdByDiscordId(id)
      return !!memberId && (await getCrewLeadMemberIds(crew)).has(memberId)
    })
  const isHost = deps.isHost ?? (async (id: string) => (await liveAccess(id)).host)
  if (await isLead(who.discordId, crewId).catch(() => false)) return true
  if (await isHost(who.discordId).catch(() => false)) return true
  const control = sub === 'stop' || sub === 'pause' || sub === 'resume' || sub === 'skip'
  if (control && resolveToggle('calls.updatesControlAnyMember', settings, deps.env ?? process.env)) {
    return (await (deps.isMember ?? (async (id: string) => !!(await findMemberIdByDiscordId(id))))(who.discordId).catch(() => false)) === true
  }
  return false
}

const REASONS: Record<string, string> = {
  disabled: 'Call updates are not enabled yet.',
  hidden: 'This call is not eligible for updates.',
  preview: 'This is a preview deploy: it never speaks.',
  cap: 'Updates have already been read three times on this call.',
  busy: 'Another update request was just started. Try again in a moment.',
  'crew-unknown': 'I could not tell which crew this call belongs to.',
  excluded: 'There are no updates for this call.',
  'filter-unreadable': 'There are no updates for this call right now.',
  empty: 'Nothing new to read for this crew right now.',
  'script-error': 'Could not build the updates. Please try again.',
  'tts-failed': 'The voice could not be generated. Please try again in a minute.',
  'speaker-error': 'Pizza-radio did not answer. Please try again in a minute.',
  'busy-elsewhere': 'Pizza-radio is playing in another channel right now, so it cannot join this call.',
  'nothing-playing': 'Nothing is playing.',
}
const reasonText = (r: string | undefined) => (r && REASONS[r]) || 'Could not do that right now.'

export interface CommandDeps {
  settings?: () => Promise<Settings>
  calls?: (settings: Settings) => Promise<LiveCall[]>
  run?: RunDeps
  may?: typeof mayRun
  script?: typeof buildCrewScript
}

export interface CommandReply {
  tone: 'success' | 'error'
  headline: string
  body?: string
}

/** Run one subcommand. Never throws. */
export async function executeMetalhead(job: Pick<MetalheadJob, 'sub' | 'discordId' | 'displayName' | 'admin' | 'channelId' | 'call'>, deps: CommandDeps = {}): Promise<CommandReply> {
  const fail = (headline: string): CommandReply => ({ tone: 'error', headline })
  try {
    const settings = await (deps.settings ?? loadSettings)()
    const run = deps.run ?? defaultRunDeps()
    // The script preview costs nothing and plays nothing, so it works before the updates themselves are switched on.
    if (job.sub !== 'script' && !updatesEnabled(settings, run.env)) return fail('Call updates are not enabled yet.')
    const picked = pickCall(await (deps.calls ?? liveCalls)(settings), job.channelId, job.call)
    if (!picked.ok) return fail(picked.message)
    const call = picked.call
    if (!(await (deps.may ?? mayRun)(job.sub, { discordId: job.discordId, admin: job.admin }, call.crewId, settings, { env: run.env }))) {
      return fail('Only this crew\'s leads, admins and call hosts can do that.')
    }

    if (job.sub === 'script') {
      const s = await (deps.script ?? buildCrewScript)(call.crewId, settings)
      if (s.kind === 'none') return fail(reasonText(s.reason))
      const header = `About ${s.estSeconds} seconds, ${s.sections.length} clips (nothing was played).`
      const dropped = s.dropped.length ? `\nLeft out to fit the time limit: ${s.dropped.join(', ')}.` : ''
      return { tone: 'success', headline: `${call.crewLabel ?? 'Crew'} updates script`, body: `${header}${dropped}\n\n${s.text}`.slice(0, 3800) }
    }

    if (job.sub === 'updates') {
      const r = await startUpdates(call, { trigger: 'command', startedBy: job.discordId }, run)
      if (r.status === 'playing') return { tone: 'success', headline: 'Reading the updates.', body: `About ${r.estSeconds ?? '?'} seconds. Use /metalhead pause, skip or stop any time.` }
      if (r.status === 'queued') return { tone: 'success', headline: 'Updates are queued behind the music.', body: 'They start when the song ends. /metalhead stop cancels them.' }
      return fail(reasonText(r.reason))
    }

    const r = await controlUpdates(job.sub, call, { discordId: job.discordId, displayName: job.displayName }, run)
    if (!r.ok) return fail(reasonText(r.reason))
    const done = { stop: 'Stopped. Recording is not affected.', pause: 'Paused.', resume: 'Resumed.', skip: 'Skipped to the next part.' } as const
    return { tone: 'success', headline: done[job.sub] }
  } catch (err) {
    console.error('[/metalhead] failed:', err instanceof Error ? err.message : String(err))
    return fail('Something went wrong. Please try again.')
  }
}

async function editOriginal(job: Pick<MetalheadJob, 'applicationId' | 'token'>, embed: Embed, fetchImpl: typeof fetch): Promise<void> {
  const res = await fetchImpl(editOriginalUrl(job.applicationId, job.token), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Discord ${res.status} editing the /metalhead reply`)
}

/** The deferred half: do the work, edit the ephemeral reply. Never throws. */
export async function runMetalheadCommand(job: MetalheadJob, deps: CommandDeps = {}, fetchImpl: typeof fetch = fetch): Promise<void> {
  const reply = await executeMetalhead(job, deps)
  const author: EmbedAuthor | undefined = job.author
  try {
    await editOriginal(job, makeEmbed(reply.tone, reply.headline, reply.body, { author }), fetchImpl)
  } catch (err) {
    console.error('[/metalhead] reply failed:', err instanceof Error ? err.message : String(err))
  }
}

/** Autocomplete for the `call` option: the live calls. */
export async function liveCallChoices(): Promise<Array<{ name: string; value: string }>> {
  const calls = await liveCalls(await loadSettings())
  return calls.slice(0, 25).map((c) => ({ name: (c.crewLabel ?? c.crewId).slice(0, 100), value: c.sessionId }))
}
