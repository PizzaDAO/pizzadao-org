/**
 * Contract between the recorder worker (recorder/src/ingest.ts) and the app's
 * POST /api/calls/recorder/ingest. Hand-validated (no zod dependency). Keep in
 * sync with recorder/src/types.ts.
 *
 * R2 keys must live under `calls/<sessionId>/`: the app signs URLs for the keys
 * stored on a recording, so a worker bug (or leaked key) must not be able to
 * point it at unrelated objects.
 */
import { ValidationError } from '@/app/lib/errors/api-errors'

export const SNOWFLAKE = /^\d{5,25}$/
/** A speaker id on a stored call: a Discord id, or `xs:N` for a speaker diarized from an imported call. */
export const SPEAKER_ID = /^(\d{5,25}|xs:\d{1,3})$/
/** A transcript line key (see segmentKey): chat `c:<messageId>`, speech `s:<speaker>:<startMs>`. */
export const SEGMENT_KEY = /^(c:\d{5,25}|s:(\d{5,25}|xs:\d{1,3}):\d{1,10})$/
const SESSION_ID = /^[A-Za-z0-9_-]{6,80}$/
export const MAX_SPEAKERS = 300
const MAX_SECONDS = 24 * 3600

export interface IngestSpeaker {
  discordId: string
  displayName: string | null
  talkTimeSec: number
  trackKey: string | null
  trackBytes: number | null
}

export interface TranscriptSegment {
  discordId: string
  startMs: number
  endMs: number
  text: string
  /** Absent (or 'speech') for spoken words; 'chat' for a message from the voice channel's text chat. */
  kind?: 'speech' | 'chat'
  /** Stable id of a chat line (`c:<messageId>`); see segmentKey. */
  id?: string
  /** Author's display name; only set on chat lines (chat authors may never have spoken). */
  name?: string
}

/** A voice-channel text chat message, as the worker reports it. */
export interface IngestChatMessage {
  discordId: string
  displayName: string | null
  text: string
  atMs: number
  messageId: string
}

export interface IngestTranscript {
  language: string | null
  segments: TranscriptSegment[]
}

export const MAX_TRANSCRIPT_SEGMENTS = 20000
export const MAX_CHAT_MESSAGES = 5000
/** Total chat text accepted per call (the worker keeps the earliest ~1M characters). */
export const MAX_CHAT_TOTAL_CHARS = 1_000_000
const MAX_SEGMENT_TEXT = 4000
const MAX_CALL_MS = MAX_SECONDS * 1000

export interface IngestPayload {
  sessionId: string
  eventId: string | null
  eventName: string | null
  channelId: string
  startedAt: Date
  endedAt: Date
  endReason: string | null
  partial: boolean
  mix: { key: string; bytes: number | null } | null
  speakers: IngestSpeaker[]
  /** Absent when the worker had no Deepgram key or transcription failed. */
  transcript: IngestTranscript | null
  /** Voice channel text chat during the call, time-ordered; empty when there was none. */
  chat: IngestChatMessage[]
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function str(v: unknown, field: string, max: number, required = false): string | null {
  if (v === undefined || v === null || v === '') {
    if (required) throw new ValidationError(`${field} is required`)
    return null
  }
  if (typeof v !== 'string' || v.length > max) throw new ValidationError(`${field} must be a string up to ${max} characters`)
  return v
}

function int(v: unknown, field: string, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) throw new ValidationError(`${field} must be a number from 0 to ${max}`)
  return Math.round(v)
}

function date(v: unknown, field: string): Date {
  const d = typeof v === 'string' ? new Date(v) : null
  if (!d || Number.isNaN(d.getTime())) throw new ValidationError(`${field} must be an ISO date`)
  return d
}

function key(v: unknown, field: string, sessionId: string): string | null {
  const k = str(v, field, 300)
  if (k === null) return null
  if (!k.startsWith(`calls/${sessionId}/`) || k.includes('..')) {
    throw new ValidationError(`${field} must be under calls/${sessionId}/`)
  }
  return k
}

function parseTranscript(v: unknown, speakerIds: Set<string>): IngestTranscript | null {
  if (v === undefined || v === null) return null
  if (!isObj(v)) throw new ValidationError('transcript must be an object')
  if (!Array.isArray(v.segments)) throw new ValidationError('transcript.segments must be an array')
  if (v.segments.length > MAX_TRANSCRIPT_SEGMENTS) throw new ValidationError(`At most ${MAX_TRANSCRIPT_SEGMENTS} transcript segments`)
  const segments: TranscriptSegment[] = []
  v.segments.forEach((raw, i) => {
    if (!isObj(raw)) throw new ValidationError(`transcript.segments[${i}] must be an object`)
    const discordId = str(raw.discordId, `transcript.segments[${i}].discordId`, 25, true)!
    if (!SNOWFLAKE.test(discordId)) throw new ValidationError(`transcript.segments[${i}].discordId must be a Discord id`)
    const text = str(raw.text, `transcript.segments[${i}].text`, MAX_SEGMENT_TEXT)?.trim()
    const startMs = int(raw.startMs, `transcript.segments[${i}].startMs`, MAX_CALL_MS)
    const endMs = int(raw.endMs, `transcript.segments[${i}].endMs`, MAX_CALL_MS)
    // Only speakers in this payload may have words: the worker drops opted-out users from
    // `speakers`, so their text can never arrive (or be stored) even if a worker bug sends it.
    if (!text || !speakerIds.has(discordId)) return
    segments.push({ discordId, startMs, endMs: Math.max(startMs, endMs), text })
  })
  segments.sort((a, b) => a.startMs - b.startMs)
  return { language: str(v.language, 'transcript.language', 20), segments }
}

function parseChat(v: unknown): IngestChatMessage[] {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) throw new ValidationError('chat must be an array')
  if (v.length > MAX_CHAT_MESSAGES) throw new ValidationError(`At most ${MAX_CHAT_MESSAGES} chat messages`)
  const out: IngestChatMessage[] = []
  const seen = new Set<string>()
  let total = 0
  v.forEach((raw, i) => {
    if (!isObj(raw)) throw new ValidationError(`chat[${i}] must be an object`)
    const discordId = str(raw.discordId, `chat[${i}].discordId`, 25, true)!
    if (!SNOWFLAKE.test(discordId)) throw new ValidationError(`chat[${i}].discordId must be a Discord id`)
    const messageId = str(raw.messageId, `chat[${i}].messageId`, 25, true)!
    if (!SNOWFLAKE.test(messageId)) throw new ValidationError(`chat[${i}].messageId must be a Discord id`)
    const text = str(raw.text, `chat[${i}].text`, MAX_SEGMENT_TEXT)?.trim()
    const atMs = int(raw.atMs, `chat[${i}].atMs`, MAX_CALL_MS)
    const displayName = str(raw.displayName, `chat[${i}].displayName`, 100)
    if (!text || seen.has(messageId)) return
    total += text.length
    if (total > MAX_CHAT_TOTAL_CHARS) throw new ValidationError(`Chat text is longer than ${MAX_CHAT_TOTAL_CHARS} characters in total`)
    seen.add(messageId)
    out.push({ discordId, displayName, text, atMs, messageId })
  })
  return out.sort((a, b) => a.atMs - b.atMs)
}

export function parseIngestPayload(body: unknown): IngestPayload {
  if (!isObj(body)) throw new ValidationError('Body must be a JSON object')

  const sessionId = str(body.sessionId, 'sessionId', 80, true)!
  if (!SESSION_ID.test(sessionId)) throw new ValidationError('sessionId has an invalid format')

  const channelId = str(body.channelId, 'channelId', 25, true)!
  if (!SNOWFLAKE.test(channelId)) throw new ValidationError('channelId must be a Discord id')
  const eventId = str(body.eventId, 'eventId', 25)
  if (eventId !== null && !SNOWFLAKE.test(eventId)) throw new ValidationError('eventId must be a Discord id')

  const startedAt = date(body.startedAt, 'startedAt')
  const endedAt = date(body.endedAt, 'endedAt')
  if (endedAt.getTime() < startedAt.getTime()) throw new ValidationError('endedAt is before startedAt')
  if (endedAt.getTime() - startedAt.getTime() > MAX_SECONDS * 1000) throw new ValidationError('Call is longer than 24 hours')

  let mix: IngestPayload['mix'] = null
  if (body.mix !== undefined && body.mix !== null) {
    if (!isObj(body.mix)) throw new ValidationError('mix must be an object')
    const k = key(body.mix.key, 'mix.key', sessionId)
    if (k) mix = { key: k, bytes: body.mix.bytes == null ? null : int(body.mix.bytes, 'mix.bytes', 2 ** 40) }
  }

  if (!Array.isArray(body.speakers)) throw new ValidationError('speakers must be an array')
  if (body.speakers.length > MAX_SPEAKERS) throw new ValidationError(`At most ${MAX_SPEAKERS} speakers`)
  const seen = new Set<string>()
  const speakers: IngestSpeaker[] = body.speakers.map((s, i) => {
    if (!isObj(s)) throw new ValidationError(`speakers[${i}] must be an object`)
    const discordId = str(s.discordId, `speakers[${i}].discordId`, 25, true)!
    if (!SNOWFLAKE.test(discordId)) throw new ValidationError(`speakers[${i}].discordId must be a Discord id`)
    if (seen.has(discordId)) throw new ValidationError(`speakers[${i}] is a duplicate`)
    seen.add(discordId)
    return {
      discordId,
      displayName: str(s.displayName, `speakers[${i}].displayName`, 100),
      talkTimeSec: int(s.talkTimeSec ?? 0, `speakers[${i}].talkTimeSec`, MAX_SECONDS),
      trackKey: key(s.trackKey, `speakers[${i}].trackKey`, sessionId),
      trackBytes: s.trackBytes == null ? null : int(s.trackBytes, `speakers[${i}].trackBytes`, 2 ** 40),
    }
  })

  return {
    sessionId,
    eventId,
    eventName: str(body.eventName, 'eventName', 200),
    channelId,
    startedAt,
    endedAt,
    endReason: str(body.endReason, 'endReason', 40),
    partial: body.partial === true,
    mix,
    speakers,
    transcript: parseTranscript(body.transcript, seen),
    chat: parseChat(body.chat),
  }
}
