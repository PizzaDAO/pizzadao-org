/**
 * Start and control a spoken call-updates run (plans/metalhead-reads-updates.md).
 *
 * startUpdates: gate (switch, hidden session, preview) -> cap (3 runs per call) -> build the script
 * (private post filter, redactions) -> claim a CallUpdatesRun row -> render the clips (OpenAI, cached
 * in R2) -> hand them to the speaker. Every refusal is a reason string; nothing here throws for an
 * expected failure, and nothing here touches the recording.
 *
 * controlUpdates: pause / resume / skip / stop, followed by one short, non-pinging line in the voice
 * channel chat naming who did it. "Stop" means stop speaking: it never stops the recording.
 *
 * Previews never speak: the speaker is a no-op unless VERCEL_ENV is "production" (see ./speaker.ts),
 * and this module refuses before any text-to-speech call when the speaker is not live.
 */
import { prisma } from '@/app/lib/db'
import { loadSettings, type Settings } from '@/app/lib/settings'
import { resolveToggle } from '@/app/lib/settings/toggles'
import { postDiscordMessage } from '@/app/lib/discord-rest'
import { buildCrewScript } from './sources'
import { renderClips, type ClipUrl, type Voice } from './tts'
import { defaultSpeaker, type Speaker } from './speaker'
import type { ScriptResult } from './script'

/** Non-skipped runs per call session (a replay is a run too). */
export const MAX_RUNS_PER_CALL = 3

export interface CallRef {
  sessionId: string
  eventId: string | null
  crewId: string
  /** The call's voice channel (also where its text chat lives). */
  channelId: string
  startedAt: Date
  hidden: boolean
}

export type StartReason =
  | 'disabled'
  | 'hidden'
  | 'preview'
  | 'cap'
  | 'busy'
  | 'crew-unknown'
  | 'excluded'
  | 'filter-unreadable'
  | 'empty'
  | 'script-error'
  | 'tts-failed'
  | 'speaker-error'
  | 'busy-elsewhere'
  | string

export interface StartResult {
  status: 'playing' | 'queued' | 'skipped'
  reason?: StartReason
  estSeconds?: number
  sections?: number
}

export interface RunRow {
  id: string
  sessionId: string
  seq: number
  status: string
}

export interface RunStore {
  /** Runs that count against the cap (everything but skipped). */
  countActive(sessionId: string): Promise<number>
  nextSeq(sessionId: string): Promise<number>
  /** Throws an error with code P2002 when (sessionId, seq) is taken. */
  create(row: { sessionId: string; seq: number; eventId: string | null; startsAt: Date; crewId: string; channelId: string; trigger: string; startedBy: string | null }): Promise<{ id: string }>
  update(id: string, data: Record<string, unknown>): Promise<void>
  latest(sessionId: string): Promise<RunRow | null>
}

export interface RunDeps {
  settings: () => Promise<Settings>
  env: Record<string, string | undefined>
  build: (crewId: string, settings: Settings) => Promise<ScriptResult>
  render: (sections: Array<{ label: string; text: string }>, voice: Voice) => Promise<{ clips: ClipUrl[] }>
  speaker: Speaker
  store: RunStore
  /** One line in the voice channel's chat. Must not throw. */
  announce: (channelId: string, text: string) => Promise<void>
}

export const prismaRunStore: RunStore = {
  countActive: (sessionId) => prisma.callUpdatesRun.count({ where: { sessionId, status: { not: 'skipped' } } }),
  nextSeq: async (sessionId) => ((await prisma.callUpdatesRun.aggregate({ where: { sessionId }, _max: { seq: true } }))._max.seq ?? -1) + 1,
  create: (row) => prisma.callUpdatesRun.create({ data: row, select: { id: true } }),
  update: async (id, data) => {
    await prisma.callUpdatesRun.update({ where: { id }, data })
  },
  latest: (sessionId) => prisma.callUpdatesRun.findFirst({ where: { sessionId, status: { not: 'skipped' } }, orderBy: { seq: 'desc' }, select: { id: true, sessionId: true, seq: true, status: true } }),
}

/** A line in the call's voice channel chat (text-in-voice). Never pings; failures are logged only. */
export async function announceInChannel(channelId: string, text: string, env: Record<string, string | undefined> = process.env): Promise<void> {
  const botToken = env.DISCORD_BOT_TOKEN?.trim()
  // Only production talks to Discord channels: previews never speak, in voice or in chat.
  if (!botToken || env.VERCEL_ENV !== 'production') return
  try {
    await postDiscordMessage({ kind: 'bot', channelId, botToken }, { content: text.slice(0, 300), allowed_mentions: { parse: [] }, flags: 4 })
  } catch (err) {
    console.error('[call-updates] announce failed:', err instanceof Error ? err.message : String(err))
  }
}

export function defaultRunDeps(env: Record<string, string | undefined> = process.env): RunDeps {
  return {
    settings: loadSettings,
    env,
    build: (crewId, settings) => buildCrewScript(crewId, settings),
    render: (sections, voice) => renderClips(sections, voice),
    speaker: defaultSpeaker(env),
    store: prismaRunStore,
    announce: (channelId, text) => announceInChannel(channelId, text, env),
  }
}

const isUniqueViolation = (err: unknown) => typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002'

export function voiceFrom(settings: Settings): Voice {
  return { voice: settings.get('calls.updatesVoice'), instructions: settings.get('calls.updatesVoiceInstructions') }
}

export function updatesEnabled(settings: Settings, env: Record<string, string | undefined>): boolean {
  return resolveToggle('calls.updatesEnabled', settings, env)
}

/** Build, render and play the updates for a live call. */
export async function startUpdates(call: CallRef, o: { trigger: 'command' | 'auto' | 'voice'; startedBy: string | null }, deps: RunDeps = defaultRunDeps()): Promise<StartResult> {
  const skip = (reason: StartReason): StartResult => ({ status: 'skipped', reason })
  const settings = await deps.settings()
  if (!updatesEnabled(settings, deps.env)) return skip('disabled')
  if (call.hidden) return skip('hidden')
  // Previews never speak: refuse before any text-to-speech spend.
  if (!deps.speaker.live) {
    await deps.speaker.play({ channelId: call.channelId, clips: [], pauseMaxMs: 0 }) // logs "preview, not speaking"
    return skip('preview')
  }
  if ((await deps.store.countActive(call.sessionId)) >= MAX_RUNS_PER_CALL) return skip('cap')

  const script = await deps.build(call.crewId, settings)
  if (script.kind === 'none') return skip(script.reason === 'error' ? 'script-error' : script.reason)

  // Claim before any paid work: a concurrent run loses the unique constraint.
  let runId: string | null = null
  for (let attempt = 0; attempt < 2 && !runId; attempt++) {
    try {
      const row = await deps.store.create({
        sessionId: call.sessionId,
        seq: await deps.store.nextSeq(call.sessionId),
        eventId: call.eventId,
        startsAt: call.startedAt,
        crewId: call.crewId,
        channelId: call.channelId,
        trigger: o.trigger,
        startedBy: o.startedBy,
      })
      runId = row.id
    } catch (err) {
      if (!isUniqueViolation(err)) throw err
    }
  }
  if (!runId) return skip('busy')
  const finish = async (status: string, reason?: string) => {
    await deps.store.update(runId!, { status, reason: reason ?? null, scriptHash: script.hash, sectionCount: script.sections.length, estSeconds: script.estSeconds }).catch(() => undefined)
  }

  let clips: ClipUrl[]
  try {
    clips = (await deps.render(script.sections.map((s) => ({ label: s.key, text: s.lines.join(' ') })), voiceFrom(settings))).clips
  } catch (err) {
    console.error('[call-updates] tts failed:', err instanceof Error ? err.message : String(err))
    await finish('skipped', 'tts-failed')
    return skip('tts-failed')
  }

  try {
    const r = await deps.speaker.play({ channelId: call.channelId, clips, ifBusy: 'queue', pauseMaxMs: settings.get('calls.updatesPauseMaxMinutes') * 60_000 })
    await finish(r.status === 'skipped' ? 'skipped' : r.status, r.reason)
    // Log the hash and counts only, never the text.
    console.log(`[call-updates] ${r.status} crew=${call.crewId} hash=${script.hash} sections=${script.sections.length} est=${script.estSeconds}s dropped=${script.dropped.length}`)
    return { status: r.status, ...(r.reason ? { reason: r.reason } : {}), estSeconds: script.estSeconds, sections: script.sections.length }
  } catch (err) {
    console.error('[call-updates] speaker failed:', err instanceof Error ? err.message : String(err))
    await finish('skipped', 'speaker-error')
    return skip('speaker-error')
  }
}

export type ControlAction = 'pause' | 'resume' | 'skip' | 'stop'

export interface ControlResult {
  ok: boolean
  reason?: string
}

const CONTROL_TEXT: Record<ControlAction, (who: string) => string> = {
  pause: (w) => `Updates paused by ${w}.`,
  resume: (w) => `Updates resumed by ${w}.`,
  skip: (w) => `Updates skipped ahead by ${w}.`,
  stop: (w) => `Playback stopped by ${w}.`,
}

const NEXT_STATUS: Record<ControlAction, string> = { pause: 'paused', resume: 'playing', skip: 'playing', stop: 'stopped' }

/** A display name that cannot ping or format: for the one-line notice. */
export const safeName = (s: string) => s.replace(/[@<>*_~`|\\\n\r]/g, '').trim().slice(0, 40) || 'a member'

export async function controlUpdates(action: ControlAction, call: Pick<CallRef, 'sessionId' | 'channelId'>, actor: { discordId: string; displayName: string }, deps: RunDeps = defaultRunDeps()): Promise<ControlResult> {
  const settings = await deps.settings()
  let r: { ok: boolean; reason?: string }
  try {
    switch (action) {
      case 'pause':
        r = await deps.speaker.pause({ pauseMaxMs: settings.get('calls.updatesPauseMaxMinutes') * 60_000 })
        break
      case 'resume':
        r = await deps.speaker.resume()
        break
      case 'skip':
        r = await deps.speaker.skip()
        break
      case 'stop':
        r = await deps.speaker.stop({ channelId: call.channelId })
        break
    }
  } catch (err) {
    console.error(`[call-updates] ${action} failed:`, err instanceof Error ? err.message : String(err))
    return { ok: false, reason: 'speaker-error' }
  }
  if (!r.ok) return r
  const latest = await deps.store.latest(call.sessionId).catch(() => null)
  if (latest) await deps.store.update(latest.id, { status: NEXT_STATUS[action], controlledBy: actor.discordId }).catch(() => undefined)
  console.log(`[call-updates] ${action} by ${actor.discordId} session=${call.sessionId}`)
  await deps.announce(call.channelId, CONTROL_TEXT[action](safeName(actor.displayName)))
  return { ok: true }
}
