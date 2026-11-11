/**
 * The app side of the spoken play-out command, on POST /api/calls/recorder/live-chunk:
 *
 * - command 'play-out-allowed' + `speakers`: which of these Discord ids may give the command
 *   (the recorder uploads bursts of those only);
 * - command 'play-out' + a few short speech bursts: answers `playOut: true` when an allowed
 *   member told Metalhead to play the closing song.
 *
 * Cheap and bounded: nothing is transcribed for people who may not give the command; bursts must be
 * short; at most MAX_SEGMENTS per request; per session at most MAX_REQUESTS_PER_SESSION checks and
 * MAX_AUDIO_MS_PER_SESSION of audio (bookkeeping rows in CallLiveChunk with a negative seq, which the
 * live action items ignore and the normal sweep deletes). Fails closed everywhere (settings
 * unreadable, switch off, crew unknown or excluded by the private post filter, role lookup failed).
 */
import { prisma } from '@/app/lib/db'
import { normalizeCrewId } from '@/app/lib/crew-id'
import { loadSettings, type Settings } from '@/app/lib/settings'
import { resolveToggle } from '@/app/lib/settings/toggles'
import { getCrewMappings } from '@/app/lib/crew-mappings'
import { getCrewLeadMemberIds } from '@/app/lib/crew-leads'
import { findMemberIdByDiscordId } from '@/app/lib/member-utils'
import { getObjectBytes } from './r2'
import { resolveCrewForEvent } from './crew-map'
import { defaultDecode, MAX_SEGMENT_BYTES, transcribeSpeaker, type LiveDeps } from './live-run'
import { isCrewExcluded, loadPostFilter, type PostFilter } from './post-filters'
import { isPlayOutCommand } from './play-out'
import { transcribeAudio, transcribeLanguage, transcriptionPrompt } from './transcribe'
import type { LiveRequest } from './live-items'

export const MAX_SEGMENTS = 3
export const MIN_COMMAND_MS = 1_000
export const MAX_COMMAND_MS = 15_000
export const ALLOWED_CACHE_MS = 60_000
export const MAX_REQUESTS_PER_SESSION = 150
export const MAX_AUDIO_MS_PER_SESSION = 20 * 60_000
const BUDGET_MS = 20_000

export interface PlayOutDeps extends Pick<LiveDeps, 'settings' | 'env' | 'resolveCrew' | 'download' | 'decode' | 'transcribe' | 'now' | 'log' | 'postFilter'> {
  /** May this speaker give the command for this crew? null = could not tell (nothing is cached). Default: roles / crew roster / member checks. */
  allowed?: (discordId: string, crewId: string, settings: Settings) => Promise<boolean | null>
}

const allowCache = new Map<string, { at: number; ok: boolean }>()
export function clearPlayOutCache(): void {
  allowCache.clear()
}

/**
 * Crew leads of the call's crew and guild admins; with calls.playOutAnyMember, any signed-up member.
 * True/false are cached for a minute; null (a lookup failed and nothing else allowed it) is not cached
 * and counts as "no".
 */
export async function mayPlayOut(
  discordId: string,
  crewId: string,
  settings: Settings,
  now: number = Date.now(),
  env: Record<string, string | undefined> = process.env,
): Promise<boolean | null> {
  const any = resolveToggle('calls.playOutAnyMember', settings, env)
  const key = `${any ? 'm' : 'l'}:${crewId}:${discordId}`
  const hit = allowCache.get(key)
  if (hit && now - hit.at < ALLOWED_CACHE_MS) return hit.ok
  let failed = false
  let ok = false
  try {
    try {
      const memberId = await findMemberIdByDiscordId(discordId)
      if (memberId) ok = (await getCrewLeadMemberIds(crewId)).has(memberId) || any
    } catch {
      failed = true // roster / member lookup unreadable: an admin may still pass below
    }
    if (!ok) {
      // isAdminDiscordId fails closed inside; it is lazy-loaded (the session module needs SESSION_SECRET at import).
      const { isAdminDiscordId } = await import('@/app/lib/auth-guards')
      ok = await isAdminDiscordId(discordId)
    }
  } catch {
    failed = true
  }
  if (!ok && failed) return null
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

type Gate = { ok: true; crewId: string; settings: Settings; env: Record<string, string | undefined> } | { ok: false; reason: string }

/** Switch on, crew known and not excluded by the private post filter. */
async function gate(req: LiveRequest, deps: PlayOutDeps): Promise<Gate> {
  const env = deps.env ?? process.env
  const settings = deps.settings ?? (await loadSettings())
  if (settings.readFailed || !resolveToggle('calls.playOutCommandEnabled', settings, env)) return { ok: false, reason: 'off' }
  let crew: { crewId: string; crewLabel: string } | null
  try {
    crew = await (deps.resolveCrew ?? defaultResolveCrew)(req)
  } catch {
    return { ok: false, reason: 'crew-unknown' }
  }
  if (!crew) return { ok: false, reason: 'crew-unknown' }
  try {
    const filter: PostFilter = await (deps.postFilter ?? (() => loadPostFilter()))()
    if (isCrewExcluded({ id: crew.crewId, label: crew.crewLabel }, filter)) return { ok: false, reason: 'crew-excluded' }
  } catch {
    return { ok: false, reason: 'filter-unreadable' }
  }
  return { ok: true, crewId: normalizeCrewId(crew.crewId), settings, env }
}

/** Which of these speakers may give the command. Ids it could not check are in neither list. */
export async function handlePlayOutAllowed(req: LiveRequest, deps: PlayOutDeps = {}): Promise<{ allowed: string[]; denied: string[]; reason?: string }> {
  const g = await gate(req, deps)
  if (!g.ok) return { allowed: [], denied: [], reason: g.reason }
  const now = deps.now ?? Date.now
  const check = deps.allowed ?? ((id: string, c: string, s: Settings) => mayPlayOut(id, c, s, now(), g.env))
  const allowed: string[] = []
  const denied: string[] = []
  await Promise.all(
    [...new Set(req.speakers ?? [])].slice(0, 10).map(async (id) => {
      const r = await check(id, g.crewId, g.settings).catch(() => null)
      if (r === true) allowed.push(id)
      else if (r === false) denied.push(id)
    }),
  )
  return { allowed, denied }
}

export async function handlePlayOutRequest(req: LiveRequest, deps: PlayOutDeps = {}): Promise<{ playOut: boolean; reason?: string }> {
  const no = (reason: string) => ({ playOut: false, reason })
  const log = deps.log ?? ((m: string) => console.warn('[calls/play-out]', m))
  const g = await gate(req, deps)
  if (!g.ok) return no(g.reason)
  const { env, settings, crewId } = g
  const apiKey = env.OPENAI_API_KEY?.trim()
  if (!deps.transcribe && !apiKey) return no('no-transcriber')
  const now = deps.now ?? Date.now
  const started = now()

  // Only this session's own burst keys, short bursts, a few per request; then only speakers who may command.
  const wanted = (req.segments ?? [])
    .filter((s) => s.key === `calls/${req.sessionId}/cmd/${s.discordId}/${s.startMs}.ogg` && s.endMs - s.startMs >= MIN_COMMAND_MS && s.endMs - s.startMs <= MAX_COMMAND_MS)
    .slice(0, MAX_SEGMENTS)
  if (wanted.length === 0) return no('nothing-to-check')
  const allowed = deps.allowed ?? ((id: string, c: string, s: Settings) => mayPlayOut(id, c, s, now(), env))
  const checks = await Promise.all(wanted.map(async (s) => ((await allowed(s.discordId, crewId, settings).catch(() => null)) === true ? s : null)))
  const segs = checks.filter((s): s is NonNullable<typeof s> => !!s)
  if (segs.length === 0) return no('speaker-not-allowed')

  // Per-session cap, counted before any transcription is paid for.
  const audioMs = segs.reduce((n, s) => n + (s.endMs - s.startMs), 0)
  const rows = await prisma.callLiveChunk.findMany({ where: { sessionId: req.sessionId, seq: { lt: 0 } }, select: { seq: true, audioMs: true } })
  if (rows.length >= MAX_REQUESTS_PER_SESSION || rows.reduce((n, r) => n + (r.audioMs ?? 0), 0) + audioMs > MAX_AUDIO_MS_PER_SESSION) return no('session-cap')
  try {
    await prisma.callLiveChunk.create({ data: { sessionId: req.sessionId, seq: rows.reduce((m, r) => Math.min(m, r.seq), 0) - 1, segments: [], segmentKeys: [], audioMs } })
  } catch {
    return no('session-cap') // a concurrent request took that slot (or the write failed): do not spend more
  }

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
