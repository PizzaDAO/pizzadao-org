/**
 * Imported calls (old X live broadcasts): validate what the operator tool built locally and store it as an
 * IN_REVIEW call. Called by scripts/calls/x-import.mjs; nothing on the website calls it.
 *
 * Idempotent on sessionId (`x-broadcast-<id>`). A re-run never overwrites a call a human has touched: a
 * PUBLISHED or REJECTED call is never replaced (not even with force), and a reviewer's edits, redactions or
 * speaker labels block a replace unless force is set. The summary code is not run here (import --apply then
 * summarize is a separate step), so importing costs no model usage.
 */
import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/app/lib/db'
import { getCrewMappings } from '@/app/lib/crew-mappings'
import { ValidationError } from '@/app/lib/errors/api-errors'
import { MAX_SPEAKERS, MAX_TRANSCRIPT_SEGMENTS, type TranscriptSegment } from './ingest-schema'
import { MAX_SUMMARY_ATTEMPTS } from './transcribe'

export const IMPORT_SESSION_ID = /^x-(broadcast|space)-[A-Za-z0-9]{8,32}$/
export const IMPORT_SPEAKER_ID = /^xs:\d{1,3}$/
/** The placeholder channel of an imported row: nothing resolves it as a Discord channel. */
export const IMPORT_CHANNEL_ID = 'x'
const MAX_SECONDS = 24 * 3600
const MAX_SEGMENT_TEXT = 4000
const MAX_META_BYTES = 8000
const SOURCE_HOSTS = ['x.com', 'twitter.com', 'pscp.tv', 'periscope.tv']

export type ImportSource = 'X_BROADCAST' | 'X_SPACE'

export interface ImportPayload {
  sessionId: string
  source: ImportSource
  sourceUrl: string | null
  eventName: string | null
  crewId: string | null
  startedAt: Date
  durationSec: number
  language: string | null
  mix: { key: string; bytes: number | null } | null
  segments: TranscriptSegment[]
  speakers: Array<{ id: string; talkTimeSec: number }>
  importMeta: Record<string, unknown>
  importedBy: string | null
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function str(v: unknown, field: string, max: number): string | null {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string' || v.length > max) throw new ValidationError(`${field} must be a string up to ${max} characters`)
  return v
}

function intIn(v: unknown, field: string, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) throw new ValidationError(`${field} must be a number from 0 to ${max}`)
  return Math.round(v)
}

/** Validate the operator tool's payload. Throws ValidationError with a field-level message; never echoes transcript text. */
export function parseImportPayload(body: unknown): ImportPayload {
  if (!isObj(body)) throw new ValidationError('Body must be an object')
  const sessionId = str(body.sessionId, 'sessionId', 80)
  if (!sessionId || !IMPORT_SESSION_ID.test(sessionId)) throw new ValidationError('sessionId must look like x-broadcast-<id>')
  const source: ImportSource = sessionId.startsWith('x-space-') ? 'X_SPACE' : 'X_BROADCAST'
  if (body.source !== undefined && body.source !== source) throw new ValidationError('source does not match the sessionId')

  const sourceUrl = str(body.sourceUrl, 'sourceUrl', 300)
  if (sourceUrl) {
    let host = ''
    try {
      const u = new URL(sourceUrl)
      if (u.protocol !== 'https:') throw new Error('scheme')
      host = u.hostname.toLowerCase().replace(/^www\./, '')
    } catch {
      throw new ValidationError('sourceUrl must be an https link')
    }
    if (!SOURCE_HOSTS.includes(host)) throw new ValidationError('sourceUrl must be an X or Periscope link')
  }

  const startedAt = typeof body.startedAt === 'string' ? new Date(body.startedAt) : null
  if (!startedAt || Number.isNaN(startedAt.getTime())) throw new ValidationError('startedAt must be an ISO date')
  const durationSec = intIn(body.durationSec, 'durationSec', MAX_SECONDS)
  if (durationSec < 1) throw new ValidationError('durationSec must be at least 1')
  const durationMs = durationSec * 1000

  if (!Array.isArray(body.speakers)) throw new ValidationError('speakers must be an array')
  if (body.speakers.length > MAX_SPEAKERS) throw new ValidationError(`At most ${MAX_SPEAKERS} speakers`)
  const seen = new Set<string>()
  const speakers = body.speakers.map((s, i) => {
    if (!isObj(s)) throw new ValidationError(`speakers[${i}] must be an object`)
    const id = str(s.id, `speakers[${i}].id`, 10)
    if (!id || !IMPORT_SPEAKER_ID.test(id)) throw new ValidationError(`speakers[${i}].id must look like xs:N`)
    if (seen.has(id)) throw new ValidationError(`speakers[${i}] is a duplicate`)
    seen.add(id)
    return { id, talkTimeSec: intIn(s.talkTimeSec ?? 0, `speakers[${i}].talkTimeSec`, MAX_SECONDS) }
  })

  if (!Array.isArray(body.segments)) throw new ValidationError('segments must be an array')
  if (body.segments.length > MAX_TRANSCRIPT_SEGMENTS) throw new ValidationError(`At most ${MAX_TRANSCRIPT_SEGMENTS} transcript segments`)
  const segments: TranscriptSegment[] = []
  body.segments.forEach((raw, i) => {
    if (!isObj(raw)) throw new ValidationError(`segments[${i}] must be an object`)
    const id = str(raw.discordId, `segments[${i}].discordId`, 10)
    if (!id || !IMPORT_SPEAKER_ID.test(id) || !seen.has(id)) throw new ValidationError(`segments[${i}].discordId must be one of the listed xs:N speakers`)
    const text = str(raw.text, `segments[${i}].text`, MAX_SEGMENT_TEXT)?.trim()
    const startMs = intIn(raw.startMs, `segments[${i}].startMs`, durationMs)
    const endMs = intIn(raw.endMs, `segments[${i}].endMs`, durationMs)
    if (endMs < startMs) throw new ValidationError(`segments[${i}] ends before it starts`)
    if (!text) return
    segments.push({ discordId: id, startMs, endMs, text, kind: 'speech' })
  })
  if (segments.length === 0) throw new ValidationError('segments has no text')
  segments.sort((a, b) => a.startMs - b.startMs)

  let mix: ImportPayload['mix'] = null
  if (body.mix !== undefined && body.mix !== null) {
    if (!isObj(body.mix)) throw new ValidationError('mix must be an object')
    const key = str(body.mix.key, 'mix.key', 300)
    if (key) {
      if (key !== `calls/${sessionId}/mix.m4a`) throw new ValidationError(`mix.key must be calls/${sessionId}/mix.m4a`)
      mix = { key, bytes: body.mix.bytes == null ? null : intIn(body.mix.bytes, 'mix.bytes', 2 ** 40) }
    }
  }

  const importMeta = isObj(body.importMeta) ? body.importMeta : {}
  const metaJson = JSON.stringify(importMeta)
  if (metaJson.length > MAX_META_BYTES) throw new ValidationError('importMeta is too large')
  if (/"text"\s*:/.test(metaJson)) throw new ValidationError('importMeta must not contain transcript text')

  return {
    sessionId,
    source,
    sourceUrl,
    eventName: str(body.eventName, 'eventName', 200),
    crewId: str(body.crewId, 'crewId', 80),
    startedAt,
    durationSec,
    language: str(body.language, 'language', 20),
    mix,
    segments,
    speakers,
    importMeta,
    importedBy: str(body.importedBy, 'importedBy', 25),
  }
}

export const transcriptSha256 = (segments: TranscriptSegment[]): string => createHash('sha256').update(JSON.stringify(segments)).digest('hex')

export type ImportOutcome =
  | { id: string; action: 'created' | 'replaced' }
  | { id: string; action: 'unchanged' }
  | { id: string; action: 'refused'; reason: string }

async function crewLabelFor(crewId: string | null): Promise<string | null> {
  if (!crewId) return null
  try {
    const { crews } = await getCrewMappings()
    return crews.find((c) => c.id === crewId)?.label ?? null
  } catch {
    return null
  }
}

/**
 * Create the imported call, or replace one the tool imported earlier. Returns what happened; a refusal says
 * why (nothing is written). `force` allows replacing a call with reviewer edits, redactions or labels, but never a
 * PUBLISHED or REJECTED one.
 */
export async function importExternalRecording(p: ImportPayload, opts: { force?: boolean; now?: Date } = {}): Promise<ImportOutcome> {
  const now = opts.now ?? new Date()
  const sha = transcriptSha256(p.segments)
  const meta = { ...p.importMeta, transcriptSha256: sha, segments: p.segments.length, speakers: p.speakers.length }
  const endedAt = new Date(p.startedAt.getTime() + p.durationSec * 1000)
  const crewLabel = await crewLabelFor(p.crewId)
  const speakerRows = p.speakers.map((s) => ({ discordId: s.id, displayName: null, talkTimeSec: s.talkTimeSec, trackKey: null, trackBytes: null }))
  const transcript = p.segments as unknown as Prisma.InputJsonValue

  const existing = await prisma.callRecording.findUnique({
    where: { sessionId: p.sessionId },
    select: {
      id: true,
      source: true,
      status: true,
      updatedAt: true,
      mixKey: true,
      importMeta: true,
      summaryEditedAt: true,
      reviewedBy: true,
      redactedSpeakerIds: true,
      redactedSegmentIds: true,
      speakerLabelsUpdatedAt: true,
    },
  })

  if (!existing) {
    const created = await prisma.callRecording.create({
      data: {
        sessionId: p.sessionId,
        status: 'IN_REVIEW',
        source: p.source,
        sourceUrl: p.sourceUrl,
        importedAt: now,
        importedBy: p.importedBy,
        importMeta: meta as Prisma.InputJsonValue,
        eventName: p.eventName,
        crewId: p.crewId,
        crewLabel,
        channelId: IMPORT_CHANNEL_ID,
        startedAt: p.startedAt,
        endedAt,
        durationSec: p.durationSec,
        endReason: 'imported',
        mixKey: p.mix?.key ?? null,
        mixBytes: p.mix?.bytes ?? null,
        transcript,
        transcriptLanguage: p.language ?? 'english',
        // Nothing automatic may pick this row up: it counts as already transcribed and already follow-up-scanned.
        transcribedAt: now,
        followupsDraftedAt: now,
        speakers: { create: speakerRows },
      },
      select: { id: true },
    })
    return { id: created.id, action: 'created' }
  }

  if (existing.source === 'DISCORD') return { id: existing.id, action: 'refused', reason: 'a Discord-recorded call has this session id' }
  if (existing.status === 'PUBLISHED' || existing.status === 'REJECTED') return { id: existing.id, action: 'refused', reason: `the call is ${existing.status}; it is never overwritten` }

  const prevSha = isObj(existing.importMeta) ? existing.importMeta.transcriptSha256 : null
  if (prevSha === sha && existing.mixKey === (p.mix?.key ?? null)) return { id: existing.id, action: 'unchanged' }

  const touched: string[] = []
  if (existing.summaryEditedAt) touched.push('a reviewer edited the summary')
  if (existing.reviewedBy) touched.push('a reviewer has handled this call')
  if ((existing.redactedSpeakerIds ?? []).length > 0 || (existing.redactedSegmentIds ?? []).length > 0) touched.push('it has redactions')
  if (existing.speakerLabelsUpdatedAt) touched.push('its speakers were labelled')
  if (touched.length > 0 && !opts.force) return { id: existing.id, action: 'refused', reason: `${touched.join(', ')} (use --force to replace)` }

  // One transaction, guarded on the row we just read: if a reviewer changed it meanwhile nothing is written.
  const replaced = await prisma.$transaction(async (tx) => {
    const res = await tx.callRecording.updateMany({
      where: { id: existing.id, updatedAt: existing.updatedAt, status: { in: ['IN_REVIEW', 'PROCESSING', 'RECORDED'] } },
      data: {
        status: 'IN_REVIEW',
        source: p.source,
        sourceUrl: p.sourceUrl,
        importedAt: now,
        importedBy: p.importedBy,
        importMeta: meta as Prisma.InputJsonValue,
        eventName: p.eventName,
        crewId: p.crewId,
        crewLabel,
        startedAt: p.startedAt,
        endedAt,
        durationSec: p.durationSec,
        mixKey: p.mix?.key ?? null,
        mixBytes: p.mix?.bytes ?? null,
        transcript,
        transcriptLanguage: p.language ?? 'english',
        transcribedAt: now,
        followupsDraftedAt: now,
        // The text under the old summary changed: summarize again.
        title: null,
        summary: null,
        actionItems: Prisma.DbNull,
        chapters: Prisma.DbNull,
        summaryGeneratedAt: null,
        summaryEditedAt: null,
        summaryError: null,
        summaryAttempts: 0,
        redactedSpeakerIds: [],
        redactedSegmentIds: [],
        redactionsUpdatedAt: null,
        speakerLabelsUpdatedAt: null,
        reviewedBy: null,
        reviewedAt: null,
        publishedAt: null,
      },
    })
    if (res.count !== 1) return false
    await tx.callSpeaker.deleteMany({ where: { recordingId: existing.id } })
    await tx.callSpeaker.createMany({ data: speakerRows.map((s) => ({ ...s, recordingId: existing.id })) })
    return true
  })
  return replaced ? { id: existing.id, action: 'replaced' } : { id: existing.id, action: 'refused', reason: 'the call changed while importing; run again' }
}

/** Imported calls still waiting for their first summary (the tool summarizes them one at a time). */
export async function listImportedNeedingSummary(take = 10): Promise<Array<{ id: string; sessionId: string }>> {
  return prisma.callRecording.findMany({
    where: { source: { not: 'DISCORD' }, status: 'IN_REVIEW', summary: null, summaryEditedAt: null, summaryAttempts: { lt: MAX_SUMMARY_ATTEMPTS }, transcript: { not: Prisma.DbNull } },
    orderBy: { startedAt: 'asc' },
    take,
    select: { id: true, sessionId: true },
  })
}
