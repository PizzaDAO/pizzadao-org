/**
 * Server-side call transcription (call-recap). The recorder's per-speaker tracks in R2 are aligned to
 * call time (a speaker's track is as long as the call), so each speaker is transcribed on its own
 * (speaker attribution for free) and segment times need no remapping. Merged by start time, the
 * speech is combined with any voice-channel chat lines already stored on the recording.
 *
 * Whisper hallucinates on silence ("Thank you.", repeated sentences), and a speaker track is mostly
 * silence (it is padded to the call length). So each track is decoded and only its speech is sent
 * (see speech.ts): speech regions are packed into chunks of at most 10 minutes, and segment times are
 * mapped back to call time. A track that cannot be decoded falls back to sending the whole file.
 * We still ask for verbose_json (per segment no_speech_prob / avg_logprob / compression_ratio), drop
 * low-confidence segments, and drop exact-repeat runs. Runs on a Vercel route (the recorder on
 * Railway has no OpenAI key); a few tracks in parallel, under the function's 300 s limit.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/app/lib/db'
import { getObjectBytes } from './r2'
import { asSegments, generateAndStoreSummaryResult, sanitizeSummaryError, type SummaryResult } from './recordings'
import { DISCORD_ONLY, importedAllowed } from './imported'
import type { TranscriptSegment } from './ingest-schema'
import { analyzeTrack, extractSpeech, mapChunkResult, planSpeech, renderChunkWav, wordJoiner, type Region, type TrackLevels, type WordTime } from './speech'

export const DEFAULT_TRANSCRIBE_MODEL = 'whisper-1'
/** OpenAI rejects uploads over 25 MB. */
export const MAX_UPLOAD_BYTES = 24 * 1024 * 1024
/** Largest track downloaded (only the speech is uploaded, so a track may be bigger than the upload limit). */
export const MAX_TRACK_DOWNLOAD_BYTES = 100 * 1024 * 1024
/** Chunks of one track sent to OpenAI at once. */
const CHUNK_CONCURRENCY = 2
/** A track with more speech than this is not attempted (stats: skipped 'too-much-audio'). */
export const MAX_SPEECH_MS = 3 * 3600 * 1000
/** Key inside transcribeTracks holding per-chunk progress of unfinished tracks (never a speaker id). */
const CHUNK_PROGRESS_KEY = '_chunks'
/** A new turn starts when the speaker changes or after a pause this long (same as the recorder). */
export const TURN_GAP_MS = 1500
const OPENAI_URL = 'https://api.openai.com/v1/audio/transcriptions'
/** Statuses where machine text may still be replaced; a published or rejected call is never touched. */
export const TRANSCRIBABLE_STATUSES = ['RECORDED', 'PROCESSING', 'IN_REVIEW'] as const
export const CLAIMED = 'claimed'
export const PROGRESS = 'progress'
const SUMMARY_STUCK_MS = 15 * 60 * 1000
const SUMMARY_RETRY_MS = 60 * 60 * 1000
/** The sweep stops retrying a summary after this many recorded failures. */
export const MAX_SUMMARY_ATTEMPTS = 3
/** The summary sweep only looks at calls this recent (an old row without a summary is a reviewer's call, not the cron's). */
export const SUMMARY_SWEEP_WINDOW_DAYS = 30
/** transcribeError of a call whose every track is over the upload limit (retrying cannot help). */
export const TOO_LARGE_ERROR = 'failed: every track is larger than the upload limit'
/** transcribeError of a call whose every track has more speech than MAX_SPEECH_MS. */
export const TOO_MUCH_AUDIO_ERROR = 'failed: every track has more speech than the limit'
/** transcribeError of a call whose tracks are each either too large or have too much speech. */
export const UNTRANSCRIBABLE_ERROR = 'failed: every track is too large or has too much speech'
/** Permanent failures: retrying cannot help, so the admin retry is not offered. */
export const PERMANENT_TRANSCRIBE_ERRORS: readonly string[] = [TOO_LARGE_ERROR, TOO_MUCH_AUDIO_ERROR, UNTRANSCRIBABLE_ERROR]
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

/**
 * Language hint sent to Whisper (ISO-639-1). Silent stretches make auto-detection guess odd
 * languages, so the default is 'en'; CALL_TRANSCRIBE_LANGUAGE='auto' sends no hint.
 */
export function transcribeLanguage(env: Record<string, string | undefined> = process.env): string | null {
  const v = env.CALL_TRANSCRIBE_LANGUAGE?.trim().toLowerCase()
  if (!v) return 'en'
  if (v === 'auto') return null
  if (/^[a-z]{2}$/.test(v)) return v
  if (!warnedBadLanguage) {
    warnedBadLanguage = true
    console.warn('[calls/transcribe] CALL_TRANSCRIBE_LANGUAGE must be a two-letter code or "auto"; using "en"')
  }
  return 'en'
}
let warnedBadLanguage = false
/** Test hook: lets the once-only warning fire again. */
export function resetLanguageWarning() {
  warnedBadLanguage = false
}

/** Lower-case English language name (what Whisper reports, e.g. 'english') for an ISO-639-1 code. */
export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code)?.toLowerCase() ?? code
  } catch {
    return code
  }
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

export interface CleanStats {
  rawSegments: number
  empty: number
  droppedDubious: number
  droppedRepeats: number
  kept: number
  words: number
  /** End of the last kept utterance, in seconds (compare with talk time to spot a track that stops early). */
  lastEndSec: number
}

const wordCount = (utterances: Utterance[]) => utterances.reduce((n, u) => n + (u.text.match(/\S+/g)?.length ?? 0), 0)

/** Whisper segments to clean call-time utterances, plus counts of what the filters dropped (no text). */
export function cleanSegmentsWithStats(raw: WhisperSegment[]): { utterances: Utterance[]; stats: CleanStats } {
  const nonEmpty = raw.filter((s) => typeof s.text === 'string' && s.text.trim().length > 0)
  const kept = nonEmpty
    .filter((s) => !isDubious(s))
    .map((s) => ({ startMs: Math.max(0, Math.round(s.start * 1000)), endMs: Math.max(0, Math.round(s.end * 1000)), text: s.text.trim() }))
    .sort((a, b) => a.startMs - b.startMs)
  const utterances = dropRepeatRuns(kept)
  return {
    utterances,
    stats: {
      rawSegments: raw.length,
      empty: raw.length - nonEmpty.length,
      droppedDubious: nonEmpty.length - kept.length,
      droppedRepeats: kept.length - utterances.length,
      kept: utterances.length,
      words: wordCount(utterances),
      lastEndSec: utterances.length ? Math.round(Math.max(...utterances.map((u) => u.endMs)) / 1000) : 0,
    },
  }
}

/** Whisper segments to clean call-time utterances. */
export function cleanSegments(raw: WhisperSegment[]): Utterance[] {
  return cleanSegmentsWithStats(raw).utterances
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
  /** Word times (requested with timestamp_granularities), used to split segments across speech regions. */
  words?: WordTime[]
}

/** Give up (permanent failure; an admin can retry by hand) after this many claimed attempts. */
export const MAX_ATTEMPTS = 3
/** No new track is started after this long into a run. */
export const START_BUDGET_MS = 150_000
/** Every OpenAI call (retries included) is over by this long into a run, leaving room for the summary inside maxDuration 300. */
export const HARD_DEADLINE_MS = 210_000
/** Per-track OpenAI call limit; each call is also capped by what is left of HARD_DEADLINE_MS. */
/** The cron route's maxDuration. */
export const FUNCTION_LIMIT_MS = 300_000
const TRACK_TIMEOUT_MS = 170_000

/** Transcribe one audio file with OpenAI. Retries 429 and 5xx while the deadline allows; errors carry the status, never the key. */
export async function transcribeAudio(
  bytes: Uint8Array,
  apiKey: string,
  opts: { model?: string; language?: string | null; words?: boolean; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; attempts?: number; deadline?: number } = {},
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
      const wav = isWav(bytes)
      form.append('file', new Blob([bytes as BlobPart], { type: wav ? 'audio/wav' : 'audio/ogg' }), wav ? 'speech.wav' : 'track.ogg')
      form.append('model', opts.model ?? transcribeModel())
      form.append('response_format', 'verbose_json')
      form.append('temperature', '0')
      if (opts.words) {
        // Word times let a segment that spans two speech regions be split at the boundary.
        form.append('timestamp_granularities[]', 'word')
        form.append('timestamp_granularities[]', 'segment')
      }
      const language = opts.language === undefined ? transcribeLanguage() : opts.language
      if (language) form.append('language', language)
      const res = await doFetch(OPENAI_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(Math.min(TRACK_TIMEOUT_MS, remaining)),
      })
      if (res.ok) {
        const json = (await res.json()) as { language?: string; segments?: WhisperSegment[]; words?: WordTime[] }
        return { segments: Array.isArray(json.segments) ? json.segments : [], language: json.language ?? null, words: Array.isArray(json.words) ? json.words : [] }
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

/** Only the fields the filters use (drops tokens and the like before segments are saved as progress). */
export function slimSegment(s: WhisperSegment): WhisperSegment {
  const out: WhisperSegment = { start: s.start, end: s.end, text: s.text }
  if (typeof s.avg_logprob === 'number') out.avg_logprob = s.avg_logprob
  if (typeof s.no_speech_prob === 'number') out.no_speech_prob = s.no_speech_prob
  if (typeof s.compression_ratio === 'number') out.compression_ratio = s.compression_ratio
  return out
}

/** True for a RIFF/WAVE file (speech chunks); anything else is sent as the recorder's Ogg. */
export function isWav(bytes: Uint8Array): boolean {
  const tag = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4))
  return bytes.length >= 12 && tag(0) === 'RIFF' && tag(8) === 'WAVE'
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
  | 'transcribed-no-summary' // transcript saved, but the summary failed (error saved on the row; the sweep retries)
  | 'already-had-speech'
  | 'nothing-to-transcribe' // no usable tracks; OpenAI was not called
  | 'empty-transcript' // OpenAI was called and heard no speech
  | 'progress' // some tracks done, the rest resume on the next run
  | 'not-eligible'
  | 'busy'
  | 'failed'
  | 'no-key'

/** Outcomes that mean this run spent OpenAI calls (the cron stops after one of them). */
export const USED_OPENAI: ReadonlySet<TranscribeOutcome> = new Set(['transcribed', 'transcribed-no-summary', 'empty-transcript', 'progress', 'failed'])

export interface TranscribeDeps {
  apiKey?: string
  download?: (key: string) => Promise<Uint8Array>
  /** opts.words: also ask for word times (speech chunks only). */
  transcribe?: (bytes: Uint8Array, apiKey: string, deadline: number, opts: { language: string | null; words?: boolean }) => Promise<WhisperResult>
  /** First decoding pass (per-frame levels); a throw sends the whole track instead. */
  decode?: (bytes: Uint8Array) => Promise<TrackLevels>
  /** Second decoding pass: 16-bit samples of the wanted speech regions. */
  extract?: (bytes: Uint8Array, regions: Array<Region | null>) => Promise<Array<Int16Array | undefined>>
  summarize?: (id: string, opts: { onlyIfEmpty?: boolean; unlessEdited?: boolean; budgetMs?: number }) => Promise<boolean | SummaryResult | void>
  /** Whisper language hint; undefined reads CALL_TRANSCRIBE_LANGUAGE, null sends none. */
  language?: string | null
  now?: Date
  clock?: () => number
  /** When the surrounding run started (the cron shares one start across recordings so budgets are absolute). */
  startedMs?: number
  /** Incremented before every OpenAI call, so a caller can tell a run spent money even if it ended 'busy' / 'already-had-speech'. */
  usage?: { calls: number }
  log?: (msg: string) => void
}

const hasSpeech = (segs: TranscriptSegment[]) => segs.some((s) => s.kind !== 'chat')

/** Per-track counts saved in transcribeStats (never text). */
export interface TrackStats extends CleanStats {
  /** 'speech': only VAD speech was sent; 'whole-track': the file as is (decoding failed). */
  mode: 'speech' | 'whole-track'
  /** Seconds of audio found to be speech (and sent); 0 in whole-track mode. */
  speechSec: number
  /** Chunks sent (1 in whole-track mode). */
  chunks: number
  /** OpenAI requests made for this track (each may retry internally). */
  requests: number
  /** Opus frames the decoder could not decode. */
  decodeErrors?: number
  /** Segments that ran across two speech regions and were split there by word times. */
  splitSegments?: number
  /** Such segments without word times, cut at the end of their first region. */
  cappedSegments?: number
  /** Why the speech path was not used. */
  fallback?: 'decode-failed'
}

type TrackResult = { utterances: Utterance[]; language: string | null; talkTimeSec: number; stats?: TrackStats | CleanStats } | { skipped: string }
type TrackResults = Record<string, TrackResult>

/** Chunks of an unfinished track already paid for; a later run resumes at the next chunk. */
interface ChunkProgress {
  /** planFingerprint of the chunk layout: the progress is used only if the track plans to exactly the same chunks again. */
  plan: string
  /** Chunk index -> segments already mapped to call time. */
  done: Record<string, WhisperSegment[]>
  language: string | null
  requests: number
  split: number
  capped: number
}

function parseTrackResults(v: unknown): { saved: TrackResults; progress: Record<string, ChunkProgress> } {
  const all = v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {}
  const progress = (all[CHUNK_PROGRESS_KEY] ?? {}) as Record<string, ChunkProgress>
  delete all[CHUNK_PROGRESS_KEY]
  return { saved: all as TrackResults, progress }
}

const eligibleWhere = (now: Date) => ({
  // Imported calls have no per-speaker tracks and are never re-transcribed by the app.
  ...DISCORD_ONLY,
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
  const startedMs = deps.startedMs ?? clock()
  const now = deps.now ?? new Date(clock())

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
    await prisma.callRecording.updateMany({ where: { id, transcribedAt: null }, data: { transcribedAt: now, retranscribeRequestedAt: null } })
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

  const download = deps.download ?? ((key: string) => getObjectBytes(key, MAX_TRACK_DOWNLOAD_BYTES))
  const analyze = deps.decode ?? analyzeTrack
  const extract = deps.extract ?? extractSpeech
  // Decoding is CPU and memory heavy: one track at a time (uploads still overlap).
  let decodeQueue: Promise<unknown> = Promise.resolve()
  const oneAtATime = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = decodeQueue.then(fn)
    decodeQueue = p.catch(() => {})
    return p
  }
  const hint = deps.language === undefined ? transcribeLanguage() : deps.language
  const rawSend = deps.transcribe ?? ((bytes: Uint8Array, key: string, deadline: number, o: { language: string | null; words?: boolean }) => transcribeAudio(bytes, key, { deadline, language: o.language, words: o.words }))
  const send = (bytes: Uint8Array, key: string, deadline: number, words = false) => {
    if (deps.usage) deps.usage.calls++
    return rawSend(bytes, key, deadline, words ? { language: hint, words: true } : { language: hint })
  }
  const { saved, progress } = parseTrackResults(rec.transcribeTracks)
  const snapshot = () =>
    JSON.parse(JSON.stringify(Object.keys(progress).length ? { ...saved, [CHUNK_PROGRESS_KEY]: progress } : saved)) as Prisma.InputJsonValue
  const todo = tracks.filter((t) => !(t.discordId in saved))
  const errors: string[] = []
  let progressed = 0
  // Track results are written one at a time, each carrying everything saved so far, so commits cannot land out of order and drop a track.
  let chain: Promise<unknown> = Promise.resolve()
  const persist = () => {
    const next = chain.then(() => prisma.callRecording.updateMany({ where: { id }, data: { transcribeTracks: snapshot() } }))
    chain = next.catch(() => {})
    return next
  }
  const commit = async (discordId: string, result: TrackResult): Promise<boolean> => {
    saved[discordId] = result
    try {
      await persist()
      progressed++
      return true
    } catch (err) {
      delete saved[discordId]
      errors.push(`${discordId}: could not save result: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200))
      return false
    }
  }
  let lastChunkError: string | null = null
  /** Save one paid chunk of an unfinished track (best effort: a lost write only costs that chunk again). */
  const saveChunk = async (): Promise<void> => {
    try {
      await persist()
      progressed++
    } catch {
      // the chunk stays in memory for this run
    }
  }
  await pool(todo, 3, async (t) => {
    if (clock() - startedMs > START_BUDGET_MS) return
    try {
      let bytes: Uint8Array | null
      try {
        bytes = await download(t.trackKey)
      } catch (err) {
        if (err instanceof Error && /\(limit \d+\)/.test(err.message)) {
          await commit(t.discordId, { skipped: 'too-large' })
          return
        }
        throw err
      }
      const deadline = startedMs + HARD_DEADLINE_MS
      const prior = progress[t.discordId]
      // Two decoding passes: levels for the VAD, then the samples of the speech still to send.
      const prepared = await oneAtATime(async () => {
        let levels: TrackLevels
        try {
          levels = await analyze(bytes!)
        } catch (err) {
          log(`track for ${t.discordId} could not be decoded (${err instanceof Error ? err.message : String(err)}); sending the whole track`)
          return null
        }
        const plan = planSpeech(levels)
        if (plan.speechMs > MAX_SPEECH_MS) return { levels, plan, tooMuch: true as const }
        const state: ChunkProgress =
          prior && prior.plan === plan.fingerprint
            ? prior
            : { plan: plan.fingerprint, done: {}, language: null, requests: 0, split: 0, capped: 0 }
        const wanted: Array<Region | null> = plan.regions.map(() => null)
        for (const [i, c] of plan.chunks.entries()) if (!(i in state.done)) for (const p of c.pieces) wanted[p.region] = plan.regions[p.region]
        const pcm = wanted.some(Boolean) ? await extract(bytes!, wanted) : []
        return { levels, plan, state, pcm }
      })
      let segments: WhisperSegment[] = []
      let language: string | null = null
      let extra: Omit<TrackStats, keyof CleanStats>
      if (prepared && 'tooMuch' in prepared) {
        log(`track for ${t.discordId} has ${Math.round(prepared.plan.speechMs / 1000)}s of speech (limit ${MAX_SPEECH_MS / 1000}s); not transcribed`)
        await commit(t.discordId, { skipped: 'too-much-audio' })
        return
      }
      if (prepared) {
        bytes = null // the file is no longer needed; only the extracted speech is
        const { plan, state, pcm, levels } = prepared
        // A track counts only when every chunk succeeded; after the first failure no more chunks are
        // sent, and no new chunk starts after the run's start budget (finished chunks are kept for the next run).
        let failure: unknown = null
        let outOfTime = false
        const todoChunks = plan.chunks.map((c, i) => ({ c, i })).filter(({ i }) => !(i in state.done))
        await pool(todoChunks, CHUNK_CONCURRENCY, async ({ c, i }) => {
          if (failure || outOfTime) return
          if (clock() - startedMs > START_BUDGET_MS) {
            outOfTime = true
            return
          }
          try {
            state.requests++
            const r = await send(renderChunkWav(c, pcm), apiKey, deadline, true)
            for (const p of c.pieces) pcm[p.region] = undefined
            const mapped = mapChunkResult(c, r.segments, r.words, wordJoiner(hint ?? r.language))
            state.done[i] = mapped.segments.map(slimSegment)
            state.split += mapped.split
            state.capped += mapped.capped
            state.language ??= r.language
            if (plan.chunks.length > 1 && Object.keys(state.done).length < plan.chunks.length) {
              progress[t.discordId] = state
              await saveChunk()
            }
          } catch (err) {
            failure ??= err
            lastChunkError = sanitizeSummaryError(err instanceof Error ? err.message : String(err))
          }
        })
        if (failure) throw failure
        if (outOfTime) {
          log(`track for ${t.discordId}: ${Object.keys(state.done).length}/${plan.chunks.length} chunks done; resuming next run`)
          return
        }
        segments = plan.chunks.flatMap((_, i) => state.done[i] ?? [])
        language = state.language
        if (state.capped) log(`track for ${t.discordId}: ${state.capped} segment(s) across regions had no word times and were cut`)
        extra = {
          mode: 'speech', speechSec: Math.round(plan.speechMs / 1000), chunks: plan.chunks.length, requests: state.requests,
          decodeErrors: levels.decodeErrors, splitSegments: state.split, cappedSegments: state.capped,
        }
      } else {
        if (bytes!.byteLength > MAX_UPLOAD_BYTES) {
          await commit(t.discordId, { skipped: 'too-large' })
          return
        }
        const r = await send(bytes!, apiKey, deadline)
        segments = r.segments
        language = r.language
        extra = { mode: 'whole-track', speechSec: 0, chunks: 1, requests: 1, fallback: 'decode-failed' }
      }
      // Persist now: a killed run must not make the next one pay for this track again.
      const cleaned = cleanSegmentsWithStats(segments)
      const stats: TrackStats = { ...cleaned.stats, ...extra }
      log(`track stats: mode=${stats.mode} talk=${t.talkTimeSec}s speech=${stats.speechSec}s chunks=${stats.chunks} requests=${stats.requests} raw=${stats.rawSegments} kept=${stats.kept} dubious=${stats.droppedDubious} repeats=${stats.droppedRepeats} words=${stats.words} lastEnd=${stats.lastEndSec}s hint=${hint ?? 'auto'}`)
      delete progress[t.discordId]
      await commit(t.discordId, { utterances: cleaned.utterances, language: hint ? languageName(hint) : language, talkTimeSec: t.talkTimeSec, stats })
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
    const reasons = new Set(tracks.map((t) => (saved[t.discordId] as { skipped?: string } | undefined)?.skipped))
    const permanent = reasons.size === 1 && reasons.has('too-large') ? TOO_LARGE_ERROR : reasons.size === 1 && reasons.has('too-much-audio') ? TOO_MUCH_AUDIO_ERROR : UNTRANSCRIBABLE_ERROR
    await prisma.callRecording.updateMany({ where: { id, transcribedAt: null }, data: { transcribeError: permanent, transcribeAttempts: MAX_ATTEMPTS, transcribeTracks: snapshot() } })
    await parkForReview(id, deps.summarize)
    return 'failed'
  }
  if (remaining.length > 0 && !(lastAttempt && usable.length > 0)) {
    if (progressed > 0 && !lastAttempt) {
      // Made headway (budget ran out): resume on the next run without spending an attempt.
      // Refund the attempt only while we still hold our own claim, and never below zero.
      await prisma.callRecording.updateMany({ where: { id, transcribedAt: null, transcribeError: CLAIMED, transcribeAttempts: { gt: 0 } }, data: { transcribeError: PROGRESS, transcribeAttempts: { decrement: 1 }, transcribeTracks: snapshot(), transcribeStats: lastChunkError ? { _progress: { lastError: lastChunkError } } : Prisma.DbNull } })
      return 'progress'
    }
    await prisma.callRecording.updateMany({ where: { id, transcribedAt: null }, data: { transcribeError: `failed: ${errors[0] ?? 'time budget exhausted'}`.slice(0, 300), transcribeTracks: snapshot() } })
    // Out of attempts: hand the call to the reviewers (with a chat-only summary if there is chat) instead of leaving it parked.
    if (lastAttempt) await parkForReview(id, deps.summarize)
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
  const skippedAs = (reason: string) => tracks.filter((t) => (saved[t.discordId] as { skipped?: string } | undefined)?.skipped === reason).length
  const tooLarge = skippedAs('too-large')
  const tooMuch = skippedAs('too-much-audio')
  const skippedNotes = [tooLarge ? `${tooLarge} too large` : '', tooMuch ? `${tooMuch} with too much speech` : ''].filter(Boolean).join(', ')
  const failedTracks = remaining.length + tracks.filter((t) => 'skipped' in (saved[t.discordId] ?? {})).length
  // Per-track diagnostics (counts only, never text), keyed by speaker id.
  const stats = Object.fromEntries(
    tracks.flatMap((t) => {
      const r = saved[t.discordId]
      if (!r) return []
      return [[t.discordId, 'skipped' in r ? { talkTimeSec: t.talkTimeSec, skipped: r.skipped } : { talkTimeSec: t.talkTimeSec, language: r.language, ...(r.stats ?? {}) }]]
    }),
  )
  const res = await prisma.callRecording.updateMany({
    where: { id, transcribedAt: null, status: { in: [...TRANSCRIBABLE_STATUSES] }, updatedAt: fresh.updatedAt },
    data: {
      ...(merged.length > 0 ? { transcript: merged as unknown as Prisma.InputJsonValue } : {}),
      ...(language ? { transcriptLanguage: language } : {}),
      transcribedAt: now,
      transcribeError: failedTracks ? `partial: ${failedTracks} track(s) could not be transcribed${skippedNotes ? ` (${skippedNotes})` : ''}` : null,
      transcribeTracks: Prisma.DbNull,
      transcribeStats: stats as Prisma.InputJsonValue,
      retranscribeRequestedAt: null,
    },
  })
  if (res.count !== 1) return 'busy'
  if (speech.length === 0) return 'empty-transcript'
  // A reviewer-edited summary is never regenerated automatically. Past the hard deadline the
  // summary is left to the cron's sweep (the row has transcribedAt and no summary).
  if (!rec.summaryEditedAt && clock() - startedMs < HARD_DEADLINE_MS) {
    // Abort the model calls in time for the function limit (maxDuration 300 s, 10 s margin).
    const budgetMs = FUNCTION_LIMIT_MS - (clock() - startedMs) - 10_000
    const r = await (deps.summarize ?? generateAndStoreSummaryResult)(id, { onlyIfEmpty: false, unlessEdited: true, budgetMs })
    if (r === 'skipped') log('summary skipped on purpose (nothing was written)')
    // false (mocks / older callers) and 'failed' both mean the model did not produce a summary; 'skipped' is not a failure.
    if (r === false || r === 'failed') return 'transcribed-no-summary'
  }
  return 'transcribed'
}

/** Recordings still waiting for server-side transcription (oldest first). */
export async function listPendingTranscription(sinceDays = 14, take = 10, now = new Date()) {
  return prisma.callRecording.findMany({
    where: {
      ...eligibleWhere(now),
      // Rows reset by the re-transcribe tool are picked up whatever their age.
      AND: [{ OR: [{ startedAt: { gte: new Date(now.getTime() - sinceDays * 86_400_000) } }, { retranscribeRequestedAt: { not: null } }] }],
      speakers: { some: { trackKey: { not: null }, talkTimeSec: { gt: 0 } } },
    },
    orderBy: { startedAt: 'asc' },
    take,
    select: { id: true, eventName: true, crewLabel: true, startedAt: true, durationSec: true, status: true },
  })
}

/**
 * Move a call that automatic transcription gave up on out of RECORDED/PROCESSING into review, summarizing
 * whatever text exists (chat), so an admin can act (retry, edit, reject).
 */
async function parkForReview(id: string, summarize: NonNullable<TranscribeDeps['summarize']> = generateAndStoreSummaryResult): Promise<void> {
  try {
    await summarize(id, { onlyIfEmpty: true, unlessEdited: true, budgetMs: 60_000 })
  } catch {
    // the status move below is what matters
  }
  await prisma.callRecording.updateMany({ where: { id, status: { in: ['RECORDED', 'PROCESSING'] } }, data: { status: 'IN_REVIEW' } })
}

/**
 * Recordings with a transcript but no summary: the run died mid-summary, or the model failed (the row is
 * then in review with summaryError set; retried hourly, at most 3 times). Rows a reviewer edited, rows with
 * a summary, and published or rejected rows are never listed.
 * Known limit: this sweep only covers `summary: null`. A call that already had a (chat-only) summary
 * when its transcript arrived, and whose regeneration then died, keeps that old summary until a
 * reviewer clicks Regenerate; it is not stuck, just stale.
 */
export async function listNeedingSummary(now = new Date(), take = 3) {
  // Imported calls are summarized on purpose by the import tool, not by this sweep, unless calls.importedAutoSummarize is on.
  const withImported = await importedAllowed('calls.importedAutoSummarize')
  return prisma.callRecording.findMany({
    where: {
      ...(withImported ? {} : DISCORD_ONLY),
      startedAt: { gte: new Date(now.getTime() - SUMMARY_SWEEP_WINDOW_DAYS * 86_400_000) },
      summary: null,
      summaryEditedAt: null,
      summaryGeneratedAt: null,
      summaryAttempts: { lt: MAX_SUMMARY_ATTEMPTS },
      status: { in: [...TRANSCRIBABLE_STATUSES] },
      transcript: { not: Prisma.DbNull },
      AND: [
        // Transcribed by the server, or already handed to review (a failed summary moves the row there).
        { OR: [{ transcribedAt: { not: null } }, { status: 'IN_REVIEW' }] },
        // A run that died mid-summary is picked up after 15 minutes; a recorded failure waits an hour.
        {
          OR: [
            { summaryError: null, updatedAt: { lt: new Date(now.getTime() - SUMMARY_STUCK_MS) } },
            { summaryError: { not: null }, updatedAt: { lt: new Date(now.getTime() - SUMMARY_RETRY_MS) } },
          ],
        },
      ],
    },
    orderBy: { startedAt: 'asc' },
    take,
    select: { id: true },
  })
}
