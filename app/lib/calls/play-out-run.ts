/**
 * The app side of the spoken play-out command: POST /api/calls/recorder/live-chunk with
 * `command: 'play-out'` and a few short speech bursts. Answers true when a member who may give the
 * command told Metalhead to play the closing song.
 *
 * Cheap by design: nothing is stored; bursts of people who may not give the command are never
 * transcribed; bursts must be short; at most MAX_SEGMENTS per request. Fails closed everywhere
 * (settings unreadable, switch off, crew unknown, role lookup failed: no command).
 */
import { normalizeCrewId } from '@/app/lib/crew-id'
import { loadSettings, type Settings } from '@/app/lib/settings'
import { resolveToggle } from '@/app/lib/settings/toggles'
import { getCrewMappings } from '@/app/lib/crew-mappings'
import { canManageCrew } from '@/app/lib/crew-leads'
import { findMemberIdByDiscordId } from '@/app/lib/member-utils'
import { getObjectBytes } from './r2'
import { resolveCrewForEvent } from './crew-map'
import { defaultDecode, MAX_SEGMENT_BYTES, transcribeSpeaker, type LiveDeps } from './live-run'
import { isPlayOutCommand } from './play-out'
import { transcribeAudio, transcribeLanguage, transcriptionPrompt } from './transcribe'
import type { LiveRequest } from './live-items'

export const MAX_SEGMENTS = 3
export const MIN_COMMAND_MS = 1_000
export const MAX_COMMAND_MS = 15_000
export const ALLOWED_CACHE_MS = 60_000
const BUDGET_MS = 20_000

export interface PlayOutDeps extends Pick<LiveDeps, 'settings' | 'env' | 'resolveCrew' | 'download' | 'decode' | 'transcribe' | 'now' | 'log'> {
  /** May this speaker give the command for this crew? (default: settings + crew lead / admin / member checks.) */
  allowed?: (discordId: string, crewId: string, settings: Settings) => Promise<boolean>
}

const allowCache = new Map<string, { at: number; ok: boolean }>()
export function clearPlayOutCache(): void {
  allowCache.clear()
}

/** Crew leads and guild admins; with calls.playOutAnyMember, any signed-up member. Fails closed. */
export async function mayPlayOut(discordId: string, crewId: string, settings: Settings, now: number = Date.now()): Promise<boolean> {
  const any = resolveToggle('calls.playOutAnyMember', settings)
  const key = `${any ? 'm' : 'l'}:${crewId}:${discordId}`
  const hit = allowCache.get(key)
  if (hit && now - hit.at < ALLOWED_CACHE_MS) return hit.ok
  let ok = false
  try {
    ok = (await canManageCrew(discordId, crewId)) || (any && !!(await findMemberIdByDiscordId(discordId)))
  } catch {
    ok = false
  }
  allowCache.set(key, { at: now, ok })
  if (allowCache.size > 2000) allowCache.clear()
  return ok
}

async function defaultResolveCrew(req: Pick<LiveRequest, 'eventId' | 'eventName'>) {
  const { crews } = await getCrewMappings()
  return resolveCrewForEvent(
    crews.map((c) => ({ id: c.id, label: c.label, event: c.event })),
    { eventId: req.eventId, eventName: req.eventName },
  )
}

export async function handlePlayOutRequest(req: LiveRequest, deps: PlayOutDeps = {}): Promise<{ playOut: boolean; reason?: string }> {
  const no = (reason: string) => ({ playOut: false, reason })
  const log = deps.log ?? ((m: string) => console.warn('[calls/play-out]', m))
  const env = deps.env ?? process.env
  const settings = deps.settings ?? (await loadSettings())
  if (settings.readFailed || !resolveToggle('calls.playOutCommandEnabled', settings, env)) return no('off')
  const apiKey = env.OPENAI_API_KEY?.trim()
  if (!deps.transcribe && !apiKey) return no('no-transcriber')
  const now = deps.now ?? Date.now
  const started = now()

  let crew: { crewId: string; crewLabel: string } | null
  try {
    crew = await (deps.resolveCrew ?? defaultResolveCrew)(req)
  } catch {
    return no('crew-unknown')
  }
  if (!crew) return no('crew-unknown')
  const crewId = normalizeCrewId(crew.crewId)

  // Only this session's own keys, short bursts, a few per request; then only speakers who may command.
  const wanted = (req.segments ?? [])
    .filter((s) => s.key === `calls/${req.sessionId}/live/${s.discordId}/${s.startMs}.ogg` && s.endMs - s.startMs >= MIN_COMMAND_MS && s.endMs - s.startMs <= MAX_COMMAND_MS)
    .slice(0, MAX_SEGMENTS)
  if (wanted.length === 0) return no('nothing-to-check')
  const allowed = deps.allowed ?? ((id: string, c: string, s: Settings) => mayPlayOut(id, c, s, now()))
  const checks = await Promise.all(wanted.map(async (s) => ((await allowed(s.discordId, crewId, settings)) ? s : null)))
  const segs = checks.filter((s): s is NonNullable<typeof s> => !!s)
  if (segs.length === 0) return no('speaker-not-allowed')

  const hint = transcribeLanguage(env)
  const prompt = await transcriptionPrompt(settings)
  const tdeps = {
    download: deps.download ?? ((k: string) => getObjectBytes(k, MAX_SEGMENT_BYTES)),
    decode: deps.decode ?? defaultDecode,
    transcribe: deps.transcribe ?? ((wav: Uint8Array, deadline: number) => transcribeAudio(wav, apiKey!, { deadline, language: hint, prompt, words: true, attempts: 2 })),
  }
  const deadline = started + BUDGET_MS
  for (const s of segs) {
    try {
      const r = await transcribeSpeaker([s], tdeps, deadline, hint, log)
      if (r.utterances.some((u) => isPlayOutCommand(u.text))) return { playOut: true }
    } catch (err) {
      log(`play-out check failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return no('no-command')
}
