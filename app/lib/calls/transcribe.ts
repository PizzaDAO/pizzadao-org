/**
 * Server-side call transcription (call-recap). The recorder's per-speaker tracks in R2 are aligned to
 * call time (a speaker's track is as long as the call), so each speaker is transcribed on its own
 * (speaker attribution for free) and segment times need no remapping. Merged by start time, the
 * speech is combined with any voice-channel chat lines already stored on the recording.
 *
 * Whisper hallucinates on silence ("Thank you.", repeated sentences). We ask for verbose_json (per
 * segment no_speech_prob / avg_logprob / compression_ratio), drop low-confidence segments, and drop
 * exact-repeat runs. Runs on a Vercel route (the recorder on Railway has no OpenAI key); one call to
 * OpenAI per speaker, a few in parallel, under the function's 300 s limit.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/app/lib/db'
import { getObjectBytes } from './r2'
import { asSegments, generateAndStoreSummary } from './recordings'
import type { TranscriptSegment } from './ingest-schema'

export const DEFAULT_TRANSCRIBE_MODEL = 'whisper-1'
/** OpenAI rejects uploads over 25 MB. */
export const MAX_UPLOAD_BYTES = 24 * 1024 * 1024
/** A new turn starts when the speaker changes or after a pause this long (same as the recorder). */
export const TURN_GAP_MS = 1500
const OPENAI_URL = 'https://api.openai.com/v1/audio/transcriptions'
/** Statuses where machine text may still be replaced; a published or rejected call is never touched. */
export const TRANSCRIBABLE_STATUSES = ['RECORDED', 'PROCESSING', 'IN_REVIEW'] as const
const CLAIMED = 'claimed'
const STALE_CLAIM_MS = 15 * 60 * 1000
const RETRY_AFTER_FAILURE_MS = 6 * 3600 * 1000

export interface WhisperSegment {
  start: number
  end: number
  text: string
  avg_logprob?: number
  no_speech_prob?: number
  compression_ratio?: number
}

export interface Utterance {
  startMs: number
  endMs: number
  text: string
}

export function transcribeModel(env: Record<string, string | undefined> = process.env): string {
  return env.CALL_TRANSCRIBE_MODEL?.trim() || DEFAULT_TRANSCRIBE_MODEL
}

/** Segments Whisper itself is unsure are speech (or that look like a decoding loop). */
export function isDubious(s: WhisperSegment): boolean {
  if (typeof s.compression_ratio === 'number' && s.compression_ratio > 2.4) return true
  if (typeof s.no_speech_prob === 'number' && typeof s.avg_logprob === 'number' && s.no_speech_prob > 0.6 && s.avg_logprob < -1) return true
  if (typeof s.avg_logprob === 'number' && s.avg_logprob < -1.5) return true
  return false
}

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim()
/** Lines Whisper emits over silence when it has nothing to say. */
const FILLER = new Set(['thank you', 'thanks', 'thanks for watching', 'thank you for watching', 'you', 'bye', 'bye bye', 'okay', 'ok', 'yeah', 'hmm', 'so'])

/**
 * Drop exact-repeat runs (consecutive utterances with identical text): 3 or more in a row are a
 * decoding loop and are all dropped; a pair is dropped when it is a typical filler line, otherwise
 * one copy is kept.
 */
export function dropRepeatRuns(utterances: Utterance[]): Utterance[] {
  const out: Utterance[] = []
  let i = 0
  while (i < utterances.length) {
    let j = i + 1
    const key = norm(utterances[i].text)
    while (j < utterances.length && norm(utterances[j].text) === key) j++
    const run = j - i
    if (run >= 3) {
      // hallucinated loop: drop all
    } else if (run === 2) {
      if (!FILLER.has(key)) out.push(utterances[i])
    } else {
      out.push(utterances[i])
    }
    i = j
  }
  return out
}

/** Whisper segments to clean call-time utterances. */
export function cleanSegments(raw: WhisperSegment[]): Utterance[] {
  const kept = raw
    .filter((s) => typeof s.text === 'string' && s.text.trim().length > 0 && !isDubious(s))
    .map((s) => ({ startMs: Math.max(0, Math.round(s.start * 1000)), endMs: Math.max(0, Math.round(s.end * 1000)), text: s.text.trim() }))
    .sort((a, b) => a.startMs - b.startMs)
  return dropRepeatRuns(kept)
}

/** Merge all speakers into turns ordered by start time (same rule as the recorder worker). */
export function mergeSpeakerTurns(perSpeaker: Array<{ discordId: string; utterances: Utterance[] }>, gapMs = TURN_GAP_MS): TranscriptSegment[] {
  const all = perSpeaker
    .flatMap((s) => s.utterances.map((u) => ({ discordId: s.discordId, ...u })))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
  const turns: TranscriptSegment[] = []
  for (const u of all) {
    const last = turns[turns.length - 1]
    if (last && last.discordId === u.discordId && u.startMs - last.endMs < gapMs) {
      last.text = `${last.text} ${u.text}`
      last.endMs = Math.max(last.endMs, u.endMs)
    } else {
      turns.push({ discordId: u.discordId, startMs: u.startMs, endMs: Math.max(u.startMs, u.endMs), text: u.text })
    }
  }
  return turns
}

export interface WhisperResult {
  segments: WhisperSegment[]
  language: string | null
}

/** Transcribe one audio file with OpenAI. Retries 429 and 5xx; errors carry the status, never the key. */
export async function transcribeAudio(
  bytes: Uint8Array,
  apiKey: string,
  opts: { model?: string; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; attempts?: number } = {},
): Promise<WhisperResult> {
  const doFetch = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const attempts = opts.attempts ?? 3
  let lastErr = 'not attempted'
  for (let i = 0; i < attempts; i++) {
    try {
      const form = new FormData()
      form.append('file', new Blob([bytes as BlobPart], { type: 'audio/ogg' }), 'track.ogg')
      form.append('model', opts.model ?? transcribeModel())
      form.append('response_format', 'verbose_json')
      form.append('temperature', '0')
      const res = await doFetch(OPENAI_URL, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(240_000) })
      if (res.ok) {
        const json = (await res.json()) as { language?: string; segments?: WhisperSegment[] }
        return { segments: Array.isArray(json.segments) ? json.segments : [], language: json.language ?? null }
      }
      lastErr = `OpenAI answered ${res.status}: ${(await res.text()).slice(0, 200)}`
      if (res.status !== 429 && res.status < 500) break
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err)
    }
    if (i < attempts - 1) await sleep(2000 * 2 ** i)
  }
  throw new Error(lastErr)
}

/** At most `limit` async jobs at once. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++])
    }),
  )
}

export type TranscribeOutcome = 'transcribed' | 'already-had-speech' | 'nothing-to-transcribe' | 'not-eligible' | 'busy' | 'failed' | 'no-key'

export interface TranscribeDeps {
  apiKey?: string
  download?: (key: string) => Promise<Uint8Array>
  transcribe?: (bytes: Uint8Array, apiKey: string) => Promise<WhisperResult>
  summarize?: typeof generateAndStoreSummary
  now?: Date
  log?: (msg: string) => void
}

const hasSpeech = (segs: TranscriptSegment[]) => segs.some((s) => s.kind !== 'chat')

/**
 * Transcribe one recording from its speaker tracks and (re)generate the summary.
 * Claims the row first (so the ingest hook and the cron never both run it). The stored transcript
 * stays complete: redactions are applied downstream (summary model input, public page). Never
 * overwrites an existing spoken transcript or touches a published/rejected call.
 */
export async function transcribeRecording(id: string, deps: TranscribeDeps = {}): Promise<TranscribeOutcome> {
  const apiKey = deps.apiKey ?? process.env.OPENAI_API_KEY?.trim()
  const log = deps.log ?? (() => {})
  if (!apiKey) return 'no-key'
  const now = deps.now ?? new Date()

  const rec = await prisma.callRecording.findUnique({
    where: { id },
    select: { id: true, status: true, transcript: true, transcribedAt: true, reviewedBy: true, summary: true, speakers: { select: { discordId: true, trackKey: true, talkTimeSec: true } } },
  })
  if (!rec || !(TRANSCRIBABLE_STATUSES as readonly string[]).includes(rec.status) || rec.transcribedAt) return 'not-eligible'
  const existing = asSegments(rec.transcript)
  if (hasSpeech(existing)) {
    await prisma.callRecording.updateMany({ where: { id, transcribedAt: null }, data: { transcribedAt: now } })
    return 'already-had-speech'
  }
  const tracks = rec.speakers.filter((s): s is typeof s & { trackKey: string } => !!s.trackKey && s.talkTimeSec > 0)
  if (tracks.length === 0) {
    await prisma.callRecording.updateMany({ where: { id, transcribedAt: null }, data: { transcribedAt: now } })
    return 'nothing-to-transcribe'
  }

  // Claim: one runner at a time (a claim older than STALE_CLAIM_MS is considered dead).
  const claim = await prisma.callRecording.updateMany({
    where: {
      id,
      transcribedAt: null,
      status: { in: [...TRANSCRIBABLE_STATUSES] },
      OR: [{ transcribeError: null }, { transcribeError: { not: CLAIMED } }, { updatedAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) } }],
    },
    data: { transcribeError: CLAIMED },
  })
  if (claim.count !== 1) return 'busy'

  const download = deps.download ?? ((key: string) => getObjectBytes(key))
  const send = deps.transcribe ?? ((bytes: Uint8Array, key: string) => transcribeAudio(bytes, key))
  const perSpeaker: Array<{ discordId: string; utterances: Utterance[] }> = []
  const languages = new Map<string, number>()
  const errors: string[] = []
  await pool(tracks, 3, async (t) => {
    try {
      const bytes = await download(t.trackKey)
      if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error(`track is ${bytes.byteLength} bytes (limit ${MAX_UPLOAD_BYTES})`)
      const r = await send(bytes, apiKey)
      perSpeaker.push({ discordId: t.discordId, utterances: cleanSegments(r.segments) })
      if (r.language) languages.set(r.language, (languages.get(r.language) ?? 0) + t.talkTimeSec)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`track for ${t.discordId} failed: ${msg}`)
      errors.push(`${t.discordId}: ${msg}`.slice(0, 200))
    }
  })

  if (errors.length === tracks.length) {
    await prisma.callRecording.updateMany({ where: { id, transcribedAt: null }, data: { transcribeError: `failed: ${errors[0]}`.slice(0, 300) } })
    return 'failed'
  }
  const speech = mergeSpeakerTurns(perSpeaker)
  const language = [...languages.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const merged = [...existing, ...speech].sort((a, b) => a.startMs - b.startMs)
  // A partial failure still stores what we have (and says so in transcribeError).
  const res = await prisma.callRecording.updateMany({
    where: { id, transcribedAt: null, status: { in: [...TRANSCRIBABLE_STATUSES] } },
    data: {
      ...(merged.length > 0 ? { transcript: merged as unknown as Prisma.InputJsonValue } : {}),
      transcriptLanguage: language,
      transcribedAt: now,
      transcribeError: errors.length ? `partial: ${errors.join('; ')}`.slice(0, 500) : null,
      status: 'PROCESSING',
    },
  })
  if (res.count !== 1) return 'busy'
  if (speech.length === 0) {
    await prisma.callRecording.updateMany({ where: { id, status: 'PROCESSING' }, data: { status: existing.length > 0 ? 'IN_REVIEW' : 'RECORDED' } })
    return 'nothing-to-transcribe'
  }
  // A summary nobody has touched (e.g. built from chat only) is replaced; a reviewed one is kept.
  await (deps.summarize ?? generateAndStoreSummary)(id, { onlyIfEmpty: !!rec.reviewedBy && !!rec.summary })
  return 'transcribed'
}

/** Recordings still waiting for server-side transcription (oldest first); failed ones are retried after a pause. */
export async function listPendingTranscription(sinceDays = 14, take = 10, now = new Date()) {
  return prisma.callRecording.findMany({
    where: {
      status: { in: [...TRANSCRIBABLE_STATUSES] },
      transcribedAt: null,
      startedAt: { gte: new Date(now.getTime() - sinceDays * 86_400_000) },
      speakers: { some: { trackKey: { not: null }, talkTimeSec: { gt: 0 } } },
      OR: [
        { transcribeError: null },
        { transcribeError: CLAIMED, updatedAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) } },
        { updatedAt: { lt: new Date(now.getTime() - RETRY_AFTER_FAILURE_MS) } },
      ],
    },
    orderBy: { startedAt: 'asc' },
    take,
    select: { id: true, eventName: true, crewLabel: true, startedAt: true, durationSec: true, status: true },
  })
}
