/**
 * The /live slash command's runtime: the deferred half (the handler answers within 3 s with an
 * ephemeral "thinking" reply; this runs afterwards via after() and edits the reply in), the role
 * check and the real dependencies. The logic itself is in live-announce.ts.
 */
import { getSetting, loadSettings } from '@/app/lib/settings'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { savedChannelId } from '@/app/lib/settings/channels'
import { isDreadPizzaRoberts } from '@/app/lib/mission-review-access'
import { makeEmbed, type EmbedAuthor } from '@/app/lib/discord-interactions/embeds'
import { DEFAULT_CALL_VOICE_CHANNEL_ID } from '@/app/lib/call-agenda/run'
import { prisma } from '@/app/lib/db'
import { canRunLive, LIVE_ANNOUNCE_CREW_ID, runLiveAnnounce, type LiveContext, type LiveDeps, type LiveResult } from './live-announce'
import { currentCallEvent, editOriginalUrl } from './progress-command'
import { findLiveSessions } from './live-state'
import { getCrewMappings } from '@/app/lib/crew-mappings'
import { resolveCrewForEvent } from './crew-map'
import { processOutbox } from '@/app/lib/telegram/city-posts'

export interface LiveJob {
  applicationId: string
  token: string
  /** The stream option, already validated (x.com / twitter.com). */
  stream?: string
  author?: EmbedAuthor
}

export function liveCommandEnabled(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  return toggleEnabled('calls.liveAnnounceCommandEnabled', env)
}

/** Admin (injected, the /add-money gate), Dread Pizza Roberts, or a calls.liveHostRoleIds role. Fails closed. */
export async function mayRunLive(roles: readonly string[], isAdmin: (roles: string[]) => Promise<boolean>): Promise<boolean> {
  try {
    const [admin, roberts, hostRoleSetting] = await Promise.all([
      isAdmin([...roles]).catch(() => false),
      isDreadPizzaRoberts(roles).catch(() => false),
      getSetting('calls.liveHostRoleIds').catch(() => ''),
    ])
    return canRunLive(roles, { isAdmin: admin, isRoberts: roberts, hostRoleSetting })
  } catch {
    return false
  }
}

/** The call to announce: the live Community Call session, else the event running in the call voice channel. */
export async function resolveLiveContext(now: Date = new Date()): Promise<LiveContext | null> {
  const settings = await loadSettings()
  const sessions = await findLiveSessions(settings, now.getTime()).catch(() => [])
  const s = sessions.find((x) => (x.crewId ?? '').toLowerCase() === LIVE_ANNOUNCE_CREW_ID)
  if (s) return { eventId: s.eventId, voiceChannelId: s.channelId, sessionId: s.sessionId, startedAt: s.startedAt }
  const ev = await currentCallEvent({ now }).catch(() => null)
  if (!ev || !(await isCommunityCallEvent(ev))) return null
  const channel = await callVoiceChannel()
  return { eventId: ev.id, voiceChannelId: channel, sessionId: null, startedAt: now, dayAt: ev.startsAt ?? now }
}

async function callVoiceChannel(): Promise<string> {
  return (await savedChannelId('discord.callVoiceChannelId')) || process.env.CALL_VOICE_CHANNEL_ID?.trim() || DEFAULT_CALL_VOICE_CHANNEL_ID
}

/** Only the Community Call's event may be announced by /live (the call channel hosts other crews' events too). */
async function isCommunityCallEvent(ev: { id: string; name: string }): Promise<boolean> {
  const { crews } = await getCrewMappings()
  const crew = resolveCrewForEvent(crews.map((c) => ({ id: c.id, label: c.label, event: c.event })), { eventId: ev.id, eventName: ev.name })
  return (crew?.crewId ?? '').toLowerCase() === LIVE_ANNOUNCE_CREW_ID
}

/** The community call's event in the call voice channel, when `channelId` is that channel (for a session with no event id). */
export async function resolveSessionEvent(channelId: string): Promise<{ id: string; startsAt: Date } | null> {
  if (channelId !== (await callVoiceChannel())) return null
  const ev = await currentCallEvent().catch(() => null)
  if (!ev || !ev.startsAt || !(await isCommunityCallEvent(ev))) return null
  return { id: ev.id, startsAt: ev.startsAt }
}

/** Send what was just queued now instead of waiting for the 5-minute cron. */
const kickOutbox = async () => {
  await processOutbox()
}

const mark = (done: boolean) => (done ? 'Done' : 'Skipped')

/** The ephemeral reply: what was posted, and the X text in a code block ready to copy. */
export function liveReplyText(r: LiveResult): { tone: 'success' | 'error'; title: string; body: string } {
  if (r.status === 'off') return { tone: 'error', title: "/live isn't enabled yet.", body: '' }
  if (r.status === 'no-occurrence') return { tone: 'error', title: "I can't find a call that is live right now.", body: 'Start the call (or the recording) and run /live again.' }
  if (r.status === 'error') return { tone: 'error', title: "Couldn't post the announcement.", body: `Discord said: ${(r.error ?? 'unknown error').slice(0, 300)}\nNothing was recorded as posted; run /live again.` }
  const lines: string[] = []
  if (r.status === 'preview') lines.push('This is a preview deploy: nothing was posted.')
  else if (r.status === 'already') lines.push('Already announced for this call; nothing new was posted.')
  else if (r.status === 'edited') lines.push(`Added the stream link to the Discord message (${r.discord === 'edited' ? 'edited' : 'not edited'}).`)
  else {
    lines.push(`Discord: ${r.discord === 'posted' ? 'posted' : r.discord === 'no-channel' ? 'not posted (no announcement channel set)' : r.discord === 'no-token' ? 'not posted (bot not configured)' : mark(false)}`)
    lines.push(`Telegram: ${r.telegram === 'queued' ? `queued for ${r.telegramQueued} group${r.telegramQueued === 1 ? '' : 's'}` : r.telegram === 'none' ? 'no groups set' : 'not queued (Telegram posting is off)'}`)
  }
  if (r.note) lines.push(r.note)
  if (r.streamLink) lines.push(`Stream link: ${r.streamLink}`)
  if (r.xText) lines.push('', 'X post text (copy):', '```', r.xText.replace(/```/g, "'''"), '```')
  return { tone: 'success', title: r.status === 'posted' ? "You're live" : 'Live announcement', body: lines.join('\n') }
}

/** Run /live and edit the deferred reply. Never throws. */
export async function runLiveCommand(
  job: LiveJob,
  o: { deps?: LiveDeps; resolve?: () => Promise<LiveContext | null>; fetchImpl?: typeof fetch } = {},
): Promise<void> {
  const fetchImpl = o.fetchImpl ?? fetch
  const edit = async (tone: 'success' | 'error', title: string, body: string) => {
    const res = await fetchImpl(editOriginalUrl(job.applicationId, job.token), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [makeEmbed(tone, title, body || undefined, { author: job.author })], allowed_mentions: { parse: [] } }),
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`Discord ${res.status} editing the /live reply`)
  }
  try {
    const ctx = await (o.resolve ?? (() => resolveLiveContext()))()
    const result: LiveResult = ctx
      ? await runLiveAnnounce({ mode: 'command', ctx, streamLink: job.stream }, { kick: kickOutbox, ...o.deps })
      : { status: 'no-occurrence' }
    const r = liveReplyText(result)
    await edit(r.tone, r.title, r.body)
  } catch (err) {
    console.error('[/live] failed:', err instanceof Error ? err.message : String(err))
    try {
      await edit('error', 'Something went wrong. Please try again.', '')
    } catch {
      // the token may have expired
    }
  }
}

/** The recorder-heartbeat hook: load the session and run the tick. */
export async function liveTickForSession(sessionId: string, deps: LiveDeps = {}): Promise<void> {
  const { liveAnnounceTick } = await import('./live-announce')
  const s = await prisma.callLiveSession.findUnique({ where: { sessionId } }).catch(() => null)
  await liveAnnounceTick(s, { kick: kickOutbox, resolveEvent: resolveSessionEvent, ...deps })
}
