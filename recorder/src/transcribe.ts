/**
 * Transcription (calzone-30418 phase 2).
 *
 * Per speaker: concatenate only that person's captured speech (no silence, so
 * Deepgram bills speech, not call length), transcribe it with Deepgram Nova-3,
 * map every utterance back to call time with an offset map, then merge all
 * speakers into turns ordered by start time.
 *
 * Only the speakers handed in are transcribed. finalizeSession passes every
 * speaker with a track (legacy purge records in old manifests still drop users).
 */
import { execFile } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { SpeakerSummary } from './manifest.js'
import type { IngestTranscript, TranscriptSegment } from './types.js'

const run = promisify(execFile)

/** A new turn starts when the speaker changes or after a pause this long. */
export const TURN_GAP_MS = 1500
export const TRANSCRIPT_FILE = 'transcript.json'

export interface SpeechPart {
  /** Where this part starts on the call timeline. */
  callStartMs: number
  durMs: number
}

export interface OffsetEntry extends SpeechPart {
  /** Where this part starts in the concatenated speech-only track. */
  speechStartMs: number
}

/** Offset map for parts concatenated in call order. */
export function buildOffsetMap(parts: SpeechPart[]): OffsetEntry[] {
  let at = 0
  return [...parts]
    .sort((a, b) => a.callStartMs - b.callStartMs)
    .map((p) => {
      const entry = { ...p, speechStartMs: at }
      at += p.durMs
      return entry
    })
}

/** Speech-track time to call time. Times past the end clamp into the last part. */
export function speechToCallMs(map: OffsetEntry[], speechMs: number): number {
  if (map.length === 0) return Math.max(0, Math.round(speechMs))
  let part = map[0]
  for (const e of map) {
    if (e.speechStartMs <= speechMs) part = e
    else break
  }
  const within = Math.min(Math.max(0, speechMs - part.speechStartMs), part.durMs)
  return Math.round(part.callStartMs + within)
}

export interface Utterance {
  startMs: number
  endMs: number
  text: string
}

/** Deepgram utterances (seconds, speech-track time) to call-time utterances. */
export function remapUtterances(raw: Array<{ start: number; end: number; transcript: string }>, map: OffsetEntry[]): Utterance[] {
  return raw
    .map((u) => ({
      startMs: speechToCallMs(map, u.start * 1000),
      endMs: speechToCallMs(map, u.end * 1000),
      text: (u.transcript ?? '').trim(),
    }))
    .filter((u) => u.text.length > 0)
}

/** Merge all speakers into turns, ordered by start time. */
export function mergeTranscripts(perSpeaker: Array<{ discordId: string; utterances: Utterance[] }>, gapMs = TURN_GAP_MS): TranscriptSegment[] {
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

/** ffmpeg concat-demuxer list file (single quotes escaped). */
export function buildConcatList(files: string[]): string {
  return files.map((f) => `file '${f.replace(/'/g, `'\\''`)}'`).join('\n') + '\n'
}

export function buildSpeechTrackArgs(listFile: string, outFile: string): string[] {
  return ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-ac', '1', '-c:a', 'libopus', '-b:a', '32k', outFile]
}

export const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&utterances=true&language=multi'

export interface DeepgramResult {
  utterances: Array<{ start: number; end: number; transcript: string }>
  language: string | null
}

export function parseDeepgram(body: unknown): DeepgramResult {
  const results = (body as { results?: { utterances?: unknown; channels?: Array<{ detected_language?: string; alternatives?: Array<{ languages?: string[] }> }> } })?.results
  const utterances = Array.isArray(results?.utterances)
    ? (results!.utterances as Array<{ start?: unknown; end?: unknown; transcript?: unknown }>)
        .filter((u) => typeof u.start === 'number' && typeof u.end === 'number' && typeof u.transcript === 'string')
        .map((u) => ({ start: u.start as number, end: u.end as number, transcript: u.transcript as string }))
    : []
  const ch = results?.channels?.[0]
  return { utterances, language: ch?.detected_language ?? ch?.alternatives?.[0]?.languages?.[0] ?? null }
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: Buffer; signal: AbortSignal }) => Promise<{
  ok: boolean
  status: number
  json(): Promise<unknown>
  text(): Promise<string>
}>

/** Transcribe one audio file. Retries 429 and 5xx; throws with the status (never the key) otherwise. */
export async function transcribeWithDeepgram(
  file: string,
  apiKey: string,
  deps: { fetch?: FetchLike; sleep?: (ms: number) => Promise<void>; attempts?: number } = {},
): Promise<DeepgramResult> {
  const doFetch = deps.fetch ?? (fetch as unknown as FetchLike)
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const attempts = deps.attempts ?? 3
  const body = await readFile(file)
  let lastErr = 'not attempted'
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await doFetch(DEEPGRAM_URL, {
        method: 'POST',
        headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'audio/ogg' },
        body,
        signal: AbortSignal.timeout(10 * 60_000),
      })
      if (res.ok) return parseDeepgram(await res.json())
      lastErr = `Deepgram answered ${res.status}: ${(await res.text()).slice(0, 200)}`
      if (res.status !== 429 && res.status < 500) break
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err)
    }
    if (i < attempts - 1) await sleep(2000 * 2 ** i)
  }
  throw new Error(lastErr)
}

async function defaultFfmpeg(args: string[]): Promise<void> {
  await run('ffmpeg', args, { maxBuffer: 10 * 1024 * 1024 })
}

async function defaultProbeMs(file: string): Promise<number> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
  const sec = Number(String(stdout).trim())
  if (!Number.isFinite(sec) || sec <= 0) throw new Error('no duration')
  return Math.round(sec * 1000)
}

/** Every speaker failed (e.g. Deepgram outage or bad key): worth retrying later instead of ingesting without words. */
export class TranscriptionFailedError extends Error {}

export interface TranscribeDeps {
  apiKey: string | undefined
  log: (msg: string) => void
  ffmpeg?: (args: string[]) => Promise<void>
  probeMs?: (file: string) => Promise<number>
  transcribeFile?: (file: string) => Promise<DeepgramResult>
}

let warnedNoKey = false
/** Test hook. */
export function resetNoKeyWarning(): void {
  warnedNoKey = false
}

/**
 * Transcribe the given speakers' captured speech. Returns null (and the call is
 * ingested without a transcript) when no key is set or nothing could be
 * transcribed; a failure of one speaker only drops that speaker.
 */
export async function transcribeSession(sessionDir: string, outDir: string, speakers: SpeakerSummary[], deps: TranscribeDeps): Promise<IngestTranscript | null> {
  const cached = path.join(sessionDir, TRANSCRIPT_FILE)
  if (existsSync(cached)) {
    try {
      // Re-filter by the current speaker list: someone who opted out since the cache was written must vanish.
      const allowed = new Set(speakers.map((sp) => sp.userId))
      const t = JSON.parse(readFileSync(cached, 'utf8')) as IngestTranscript
      const segments = t.segments.filter((seg) => allowed.has(seg.discordId))
      return segments.length ? { language: t.language, segments } : null
    } catch {
      // fall through and redo it
    }
  }
  if (!deps.apiKey) {
    if (!warnedNoKey) deps.log('DEEPGRAM_API_KEY is not set: calls are ingested without a transcript')
    warnedNoKey = true
    return null
  }
  const ffmpeg = deps.ffmpeg ?? defaultFfmpeg
  const probe = deps.probeMs ?? defaultProbeMs
  const send = deps.transcribeFile ?? ((file: string) => transcribeWithDeepgram(file, deps.apiKey!))

  const perSpeaker: Array<{ discordId: string; utterances: Utterance[] }> = []
  const languages = new Map<string, number>()
  let failed = 0
  for (const sp of speakers) {
    try {
      const segs = [...sp.segments].sort((a, b) => a.startMs - b.startMs)
      const parts: SpeechPart[] = []
      for (const s of segs) {
        let durMs = Math.max(0, s.endMs - s.startMs)
        try {
          durMs = await probe(path.join(sessionDir, s.file))
        } catch {
          // keep the manifest's duration
        }
        parts.push({ callStartMs: s.startMs, durMs })
      }
      const listFile = path.join(outDir, `${sp.userId}.speech.txt`)
      const speechFile = path.join(outDir, `${sp.userId}.speech.ogg`)
      writeFileSync(listFile, buildConcatList(segs.map((s) => path.join(sessionDir, s.file))))
      await ffmpeg(buildSpeechTrackArgs(listFile, speechFile))
      const result = await send(speechFile)
      perSpeaker.push({ discordId: sp.userId, utterances: remapUtterances(result.utterances, buildOffsetMap(parts)) })
      if (result.language) languages.set(result.language, (languages.get(result.language) ?? 0) + sp.talkTimeSec)
    } catch (err) {
      failed++
      deps.log(`transcription failed for ${sp.userId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (speakers.length > 0 && failed === speakers.length) throw new TranscriptionFailedError(`all ${failed} speaker(s) failed`)
  const segments = mergeTranscripts(perSpeaker)
  if (segments.length === 0) return null
  const language = [...languages.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const transcript: IngestTranscript = { language, segments }
  try {
    writeFileSync(cached, JSON.stringify(transcript))
  } catch {
    // the cache is an optimisation
  }
  return transcript
}
