/**
 * Contract between the recorder worker (recorder/src/ingest.ts) and the app's
 * POST /api/calls/recorder/ingest. Hand-validated (no zod dependency). Keep in
 * sync with recorder/src/types.ts.
 *
 * R2 keys must live under `calls/<sessionId>/`: the retention sweep deletes the
 * keys stored on a recording, so a worker bug (or leaked key) must not be able
 * to point it at unrelated objects.
 */
import { ValidationError } from '@/app/lib/errors/api-errors'

export const SNOWFLAKE = /^\d{5,25}$/
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
  }
}
