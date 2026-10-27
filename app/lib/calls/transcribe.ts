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
const PROGRESS = 'progress'
const SUMMARY_STUCK_MS = 15 * 60 * 1000
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

/** Give up (permanent failure; an admin can retry by hand) after this many claimed attempts. */
export const MAX_ATTEMPTS = 3
/** No new track is started after this long into a run. */
export const START_BUDGET_MS = 150_000
/** Every OpenAI call (retries included) is over by this long into a run, leaving room for the summary inside maxDuration 300. */
export const HARD_DEADLINE_MS = 210_000
const TRACK_TIMEOUT_MS = 120_000

/** Transcribe one audio file with OpenAI. Retries 429 and 5xx while the deadline allows; errors carry the status, never the key. */
export async function transcribeAudio(
  bytes: Uint8Array,
  apiKey: string,
  opts: { model?: string; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; attempts?: number; deadline?: number } = {},
): Promise<WhisperResult> {
  const doFetch = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const attempts = opts.attempts ?? 3
  let lastErr = 'not attempted'
  for (let i = 0; i < attempts; i++) {
    const remaining = opts.deadline === undefined ? TRACK_TIMEOUT_MS : opts.deadline - Date.now()
    if (remaining < 5_000) {
      lastErr = `${lastErr === 'not attempted' ? 'time budget exhausted' : lastErr}`
      break
    }
    try {
      const form = new FormData()
      form.append('file', new Blob([bytes as BlobPart], { type: 'audio/ogg' }), 'track.ogg')
      form.append('model', opts.model ?? transcribeModel())
      form.append('response_format', 'verbose_json')
      form.append('temperature', '0')
      const res = await doFetch(OPENAI_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(Math.min(TRACK_TIMEOUT_MS, remaining)),
      })
      if (res.ok) {
        const json = (await res.json()) as { language?: string; segments?: WhisperSegment[] }
        return { segments: Array.isArray(json.segments) ? json.segments : [], language: json.language ?? null }
      }
      lastErr = `OpenAI answered ${res.status}: ${(await res.text()).slice(0, 200)}`
      if (res.status !== 429 && res.status < 500) break
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err)
    }
    const wait = 2000 * 2 ** i
    if (i < attempts - 1 && (opts.deadline === undefined || Date.now() + wait < opts.deadline)) await sleep(wait)
    else break
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

export type TranscribeOutcome =
  | 'transcribed'
  | 'already-had-speech'
  | 'nothing-to-transcribe' // no usable tracks; OpenAI was not called
  | 'empty-transcript' // OpenAI was called and heard no speech
  | 'progress' // some tracks done, the rest resume on the next run
  | 'not-eligible'
  | 'busy'
  | 'failed'
  | 'no-key'

/** Outcomes that mean this run spent OpenAI calls (the cron stops after one of them). */
export const USED_OPENAI: ReadonlySet<TranscribeOutcome> = new Set(['transcribed', 'empty-transcript', 'progress', 'failed'])

export interface TranscribeDeps {
  apiKey?: string
  download?: (key: string) => Promise<Uint8Array>
  transcribe?: (bytes: Uint8Array, apiKey: string, deadline: number) => Promise<WhisperResult>
  summarize?: typeof generateAndStoreSummary
  now?: Date
  clock?: () => number
  log?: (msg: string) => void
}

const hasSpeech = (segs: TranscriptSegment[]) => segs.some((s) => s.kind !== 'chat')

type TrackResult = { utterances: Utterance[]; language: string | null; talkTimeSec: number } | { skipped: string }
type TrackResults = Record<string, TrackResult>

function parseTrackResults(v: unknown): TrackResults {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as TrackResults) : {}
}

const eligibleWhere = (now: Date) => ({
  transcribedAt: null,
  status: { in: [...TRANSCRIBABLE_STATUSES] },
  transcribeAttempts: { lt: MAX_ATTEMPTS },
  // null = fresh; 'progress' = resume now; anything else (running, failed) waits out the backoff.
  OR: [{ transcribeError: null }, { transcribeError: PROGRESS }, { updatedAt: { lt: new Date(now.getTime() - RETRY_AFTER_FAILURE_MS) } }],
})

/**
 * Transcribe one recording from its speaker tracks and (re)generate the summary.
 *
 * Cost control: a claim counts as an attempt (3 max, then a permanent failure an admin can retry);
 * finished tracks are saved as they complete so a retry only does the rest; no new track starts
 * after START_BUDGET_MS and every OpenAI call ends by HARD_DEADLINE_MS; a running or failed claim
 * is not retried for 6 hours. The stored transcript stays complete: redactions are applied
 * downstream, and tracks of already-redacted speakers are not transcribed at all. A worker-provided
 * spoken transcript, a reviewed/public call and a reviewer-edited summary are never overwritten.
 */
export async function transcribeRecording(id: string, deps: TranscribeDeps = {}): Promise<TranscribeOutcome> {
  const apiKey = deps.apiKey ?? process.env.OPENAI_API_KEY?.trim()
  const log = deps.log ?? (() => {})
  if (!apiKey) return 'no-key'
  const clock = deps.clock ?? Date.now
  const startedMs = clock()
  const now = deps.now ?? new Date(startedMs)

  const rec = await prisma.callRecording.findUnique({
    where: { id },
    select: {
      id: true, status: true, transcript: true, transcribedAt: true, transcribeAttempts: true, transcribeTracks: true,
      redactedSpeakerIds: true, summaryEditedAt: true,
      speakers: { select: { discordId: true, trackKey: true, talkTimeSec: true } },
    },
  })
  if (!rec || !(TRANSCRIBABLE_STATUSES as readonly string[]).includes(rec.status) || rec.transcribedAt) return 'not-eligible'
  const done = async (outcome: TranscribeOutcome): Promise<TranscribeOutcome> => {
    await prisma.callRecording.updateMany({ where: { id, transcribedAt: null }, data: { transcribedAt: now } })
    return outcome
  }
  if (hasSpeech(asSegments(rec.transcript))) return done('already-had-speech')
  const redacted = new Set(rec.redactedSpeakerIds ?? [])
  const tracks = rec.speakers.filter((s): s is typeof s & { trackKey: string } => !!s.trackKey && s.talkTimeSec > 0 && !redacted.has(s.discordId))
  if (tracks.length === 0) return done('nothing-to-transcribe')
  if ((rec.transcribeAttempts ?? 0) >= MAX_ATTEMPTS) return 'failed'

  const claim = await prisma.callRecording.updateMany({
    where: { id, ...eligibleWhere(now) },
    data: { transcribeError: CLAIMED, transcribeAttempts: { increment: 1 } },
  })
  if (claim.count !== 1) return 'busy'
  const lastAttempt = (rec.transcribeAttempts ?? 0) + 1 >= MAX_ATTEMPTS

  const download = deps.download ?? ((key: string) => getObjectBytes(key, MAX_UPLOAD_BYTES))
  const send = deps.transcribe ?? ((bytes: Uint8Array, key: string, deadline: number) => transcribeAudio(bytes, key, { deadline }))
  const saved = parseTrackResults(rec.transcribeTracks)
  const todo = tracks.filter((t) => !(t.discordId in saved))
  const errors: string[] = []
  let progressed = 0
  await pool(todo, 3, async (t) => {
    if (clock() - startedMs > START_BUDGET_MS) return
    try {
      let bytes: Uint8Array
      try {
        bytes = await download(t.trackKey)
      } catch (err) {
        if (err instanceof Error && /\(limit \d+\)/.test(err.message)) {
          saved[t.discordId] = { skipped: 'too-large' }
          progressed++
          await prisma.callRecording.updateMany({ where: { id }, data: { transcribeTracks: saved as unknown as Prisma.InputJsonValue } })
          errors.push(`${t.discordId}: track is larger than ${MAX_UPLOAD_BYTES} bytes`)
          return
        }
        throw err
      }
      if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new Error(`track is ${bytes.byteLength} bytes (limit ${MAX_UPLOAD_BYTES})`)
      const r = await send(bytes, apiKey, startedMs + HARD_DEADLINE_MS)
      saved[t.discordId] = { utterances: cleanSegments(r.segments), language: r.language, talkTimeSec: t.talkTimeSec }
      progressed++
      // Persist now: a killed run must not make the next one pay for this track again.
      await prisma.callRecording.updateMany({ where: { id }, data: { transcribeTracks: saved as unknown as Prisma.InputJsonValue } })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`track for ${t.discordId} failed: ${msg}`)
      errors.push(`${t.discordId}: ${msg}`.slice(0, 200))
    }
  })

  const remaining = tracks.filter((t) => !(t.discordId in saved))
  const usable = tracks.flatMap((t) => {
    const r = saved[t.discordId]
    return r && 'utterances' in r ? [{ discordId: t.discordId, r }] : []
  })
  const tooLargeOnly = remaining.length === 0 && usable.length === 0 && tracks.some((t) => 'skipped' in (saved[t.discordId] ?? {}))
  if (tooLargeOnly) {
    // Nothing can ever be sent to OpenAI as it is: permanent failure, no more attempts.
    await prisma.callRecording.updateMany({ where: { id, transcribedAt: null }, data: { transcribeError: 'failed: every track is larger than the upload limit', transcribeAttempts: MAX_ATTEMPTS } })
    return 'failed'
  }
  if (remaining.length > 0 && !(lastAttempt && usable.length > 0)) {
    if (progressed > 0 && !lastAttempt) {
      // Made headway (budget ran out): resume on the next run without spending an attempt.
      await prisma.callRecording.updateMany({ where: { id, transcribedAt: null }, data: { transcribeError: PROGRESS, transcribeAttempts: { decrement: 1 } } })
      return 'progress'
    }
    await prisma.callRecording.updateMany({ where: { id, transcribedAt: null }, data: { transcribeError: `failed: ${errors[0] ?? 'time budget exhausted'}`.slice(0, 300) } })
    return 'failed'
  }

  // Finalize. Re-read right before writing: if anything changed meanwhile (a worker transcript, a
  // reviewer edit) the guarded write below matches nothing instead of clobbering it.
  const fresh = await prisma.callRecording.findUnique({ where: { id }, select: { transcript: true, updatedAt: true } })
  if (!fresh) return 'not-eligible'
  const freshSegs = asSegments(fresh.transcript)
  if (hasSpeech(freshSegs)) return done('already-had-speech')
  const speech = mergeSpeakerTurns(usable.map((u) => ({ discordId: u.discordId, utterances: u.r.utterances })))
  const langWeight = new Map<string, number>()
  for (const u of usable) if (u.r.language) langWeight.set(u.r.language, (langWeight.get(u.r.language) ?? 0) + u.r.talkTimeSec)
  const language = [...langWeight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const merged = [...freshSegs, ...speech].sort((a, b) => a.startMs - b.startMs)
  const failedTracks = remaining.length
  const res = await prisma.callRecording.updateMany({
    where: { id, transcribedAt: null, status: { in: [...TRANSCRIBABLE_STATUSES] }, updatedAt: fresh.updatedAt },
    data: {
      ...(merged.length > 0 ? { transcript: merged as unknown as Prisma.InputJsonValue } : {}),
      ...(language ? { transcriptLanguage: language } : {}),
      transcribedAt: now,
      transcribeError: failedTracks ? `partial: ${failedTracks} track(s) could not be transcribed` : null,
      transcribeTracks: Prisma.DbNull,
    },
  })
  if (res.count !== 1) return 'busy'
  if (speech.length === 0) return 'empty-transcript'
  // A reviewer-edited summary is never regenerated automatically. Past the hard deadline the
  // summary is left to the cron's sweep (the row has transcribedAt and no summary).
  if (!rec.summaryEditedAt && clock() - startedMs < HARD_DEADLINE_MS) await (deps.summarize ?? generateAndStoreSummary)(id, { onlyIfEmpty: false, unlessEdited: true })
  return 'transcribed'
}

/** Recordings still waiting for server-side transcription (oldest first). */
export async function listPendingTranscription(sinceDays = 14, take = 10, now = new Date()) {
  return prisma.callRecording.findMany({
    where: {
      ...eligibleWhere(now),
      startedAt: { gte: new Date(now.getTime() - sinceDays * 86_400_000) },
      speakers: { some: { trackKey: { not: null }, talkTimeSec: { gt: 0 } } },
    },
    orderBy: { startedAt: 'asc' },
    take,
    select: { id: true, eventName: true, crewLabel: true, startedAt: true, durationSec: true, status: true },
  })
}

/** Transcribed recordings whose summary never got written (the run died mid-summary). */
export async function listNeedingSummary(now = new Date(), take = 3) {
  return prisma.callRecording.findMany({
    where: {
      transcribedAt: { not: null },
      summary: null,
      summaryEditedAt: null,
      status: { in: ['RECORDED', 'PROCESSING'] },
      transcript: { not: Prisma.DbNull },
      updatedAt: { lt: new Date(now.getTime() - SUMMARY_STUCK_MS) },
    },
    orderBy: { startedAt: 'asc' },
    take,
    select: { id: true },
  })
}
