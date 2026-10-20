/**
 * Call recordings: ingest (worker), review queries (/admin/calls), opt-outs.
 * Audio is private and kept forever; the app never writes or deletes in R2 (see r2.ts).
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/app/lib/db'
import { getCrewMappings } from '@/app/lib/crew-mappings'
import { resolveCrewForEvent, type CrewRef } from './crew-map'
import type { IngestPayload, TranscriptSegment } from './ingest-schema'
import { buildSpeakerNames, generateCallSummary } from './summarize'

/**
 * Crew list for event -> crew mapping. A sheet outage must not lose a
 * recording, so failures fall back to "no crew" (the review page still shows
 * the event name).
 */
async function loadCrews(): Promise<CrewRef[]> {
  try {
    const { crews } = await getCrewMappings()
    return crews.map((c) => ({ id: c.id, label: c.label, event: c.event }))
  } catch (err) {
    console.error('[calls/ingest] crew mappings unavailable:', err)
    return []
  }
}

/**
 * Store a recording. Idempotent on sessionId: a retry of an already-stored
 * session returns the existing row untouched (so a reviewer's status changes
 * are never clobbered by a worker retry).
 */
export async function ingestRecording(p: IngestPayload): Promise<{ id: string; duplicate: boolean; keys: string[]; summarize: boolean }> {
  const existing = await prisma.callRecording.findUnique({
    where: { sessionId: p.sessionId },
    select: { id: true, status: true, mixKey: true, speakers: { select: { trackKey: true } } },
  })
  // Opted-out people are never transcribed by the worker; drop their words here too, whatever arrives.
  let segments: TranscriptSegment[] = []
  if (p.transcript?.segments.length) {
    const optedOut = new Set(await listOptOutIds())
    segments = p.transcript.segments.filter((seg) => !optedOut.has(seg.discordId))
  }
  const hasTranscript = segments.length > 0
  // The worker deletes any R2 object under the session prefix that is NOT in `keys`
  // (leftovers of earlier attempts), so `keys` is always what the stored row references.
  if (existing) {
    // A retry may carry a transcript the first ingest lacked (e.g. Deepgram was down). Fill it in only
    // while the row is still untouched (RECORDED, no transcript); anything else stays as the reviewer left it.
    let filled = false
    if (hasTranscript && existing.status === 'RECORDED') {
      const res = await prisma.callRecording.updateMany({
        where: { id: existing.id, status: 'RECORDED', transcript: { equals: Prisma.DbNull } },
        data: { transcript: segments as unknown as Prisma.InputJsonValue, transcriptLanguage: p.transcript?.language ?? null, status: 'PROCESSING' },
      })
      filled = res.count === 1
    }
    return { id: existing.id, duplicate: true, keys: storedKeys(existing), summarize: filled }
  }
  const crew = resolveCrewForEvent(await loadCrews(), { eventId: p.eventId, eventName: p.eventName })
  const created = await prisma.callRecording.create({
    data: {
      sessionId: p.sessionId,
      discordEventId: p.eventId,
      eventName: p.eventName,
      crewId: crew?.crewId ?? null,
      crewLabel: crew?.crewLabel ?? null,
      channelId: p.channelId,
      startedAt: p.startedAt,
      endedAt: p.endedAt,
      durationSec: Math.max(0, Math.round((p.endedAt.getTime() - p.startedAt.getTime()) / 1000)),
      endReason: p.endReason,
      partial: p.partial,
      mixKey: p.mix?.key ?? null,
      mixBytes: p.mix?.bytes ?? null,
      ...(hasTranscript
        ? { transcript: segments as unknown as Prisma.InputJsonValue, transcriptLanguage: p.transcript?.language ?? null, status: 'PROCESSING' as const }
        : {}),
      speakers: {
        create: p.speakers.map((s) => ({
          discordId: s.discordId,
          displayName: s.displayName,
          talkTimeSec: s.talkTimeSec,
          trackKey: s.trackKey,
          trackBytes: s.trackBytes,
        })),
      },
    },
    select: { id: true },
  })
  return {
    id: created.id,
    duplicate: false,
    keys: storedKeys({ mixKey: p.mix?.key ?? null, speakers: p.speakers.map((s) => ({ trackKey: s.trackKey })) }),
    summarize: hasTranscript,
  }
}

function storedKeys(r: { mixKey: string | null; speakers: Array<{ trackKey: string | null }> }): string[] {
  return [r.mixKey, ...r.speakers.map((s) => s.trackKey)].filter((k): k is string => !!k)
}

export async function listRecordings(take = 100) {
  return prisma.callRecording.findMany({
    orderBy: { startedAt: 'desc' },
    take,
    select: {
      id: true,
      status: true,
      eventName: true,
      crewId: true,
      crewLabel: true,
      startedAt: true,
      durationSec: true,
      partial: true,
      audioDeletedAt: true,
      _count: { select: { speakers: true } },
    },
  })
}

export async function getRecording(id: string) {
  return prisma.callRecording.findUnique({
    where: { id },
    include: { speakers: { orderBy: { talkTimeSec: 'desc' } } },
  })
}

/**
 * Reject (hide) a recording: status REJECTED with who/when, in one update. The
 * row, speakers, metadata and audio are all kept; R2 is never touched.
 * Returns false when the recording is unknown.
 */
export async function rejectRecording(id: string, reviewerDiscordId: string, now = new Date()): Promise<boolean> {
  const rec = await prisma.callRecording.findUnique({ where: { id }, select: { id: true } })
  if (!rec) return false
  await prisma.callRecording.update({
    where: { id: rec.id },
    data: { status: 'REJECTED', reviewedBy: reviewerDiscordId, reviewedAt: now, publishedAt: null },
  })
  return true
}

/** Discord ids the worker must never record. */
export async function listOptOutIds(): Promise<string[]> {
  const rows = await prisma.recordingOptOut.findMany({ select: { discordId: true } })
  return rows.map((r) => r.discordId)
}

/** /record optout (true) and /record optin (false). Both are idempotent. */
export async function setRecordingOptOut(discordId: string, optedOut: boolean): Promise<void> {
  if (optedOut) {
    await prisma.recordingOptOut.upsert({ where: { discordId }, create: { discordId }, update: {} })
  } else {
    await prisma.recordingOptOut.deleteMany({ where: { discordId } })
  }
}

// ---- Phase 2: summary, review edits, publish ----

/** Public view of a call: summary + transcript only. Never any R2 key, audio or per-speaker track. */
const PUBLIC_SELECT = {
  id: true,
  crewId: true,
  crewLabel: true,
  eventName: true,
  startedAt: true,
  durationSec: true,
  title: true,
  summary: true,
  actionItems: true,
  chapters: true,
  transcript: true,
  transcriptLanguage: true,
  publishedAt: true,
  speakers: { select: { discordId: true, displayName: true } },
} as const

const PUBLIC_LIST_SELECT = {
  id: true,
  crewLabel: true,
  eventName: true,
  startedAt: true,
  durationSec: true,
  title: true,
  summary: true,
} as const

export async function listPublishedRecordings(take = 100) {
  return prisma.callRecording.findMany({
    where: { status: 'PUBLISHED' },
    orderBy: { startedAt: 'desc' },
    take,
    select: PUBLIC_LIST_SELECT,
  })
}

/** Null unless the call is PUBLISHED: in-review, recorded and rejected calls are not public. */
export async function getPublishedRecording(id: string) {
  return prisma.callRecording.findFirst({ where: { id, status: 'PUBLISHED' }, select: PUBLIC_SELECT })
}

export function asSegments(v: unknown): TranscriptSegment[] {
  return Array.isArray(v) ? (v as TranscriptSegment[]) : []
}

/**
 * Generate (or regenerate) the AI title/summary/chapters/action items from the
 * stored transcript. The result always goes back to IN_REVIEW with publishedAt
 * cleared (a regenerated PUBLISHED call is not public until a reviewer
 * publishes it again); REJECTED calls are left alone. `onlyIfEmpty` (the
 * automatic run after ingest) writes only while the row still has no summary,
 * so it never overwrites a reviewer's work. A model failure keeps the transcript
 * and moves a fresh call to review so a human can retry.
 */
export async function generateAndStoreSummary(id: string, opts: { onlyIfEmpty?: boolean } = {}): Promise<boolean> {
  const rec = await prisma.callRecording.findUnique({
    where: { id },
    select: { id: true, status: true, transcript: true, speakers: { select: { discordId: true, displayName: true } } },
  })
  if (!rec || rec.status === 'REJECTED') return false
  const fresh = rec.status === 'PROCESSING' || rec.status === 'RECORDED'
  const toReview = () => (fresh ? prisma.callRecording.update({ where: { id }, data: { status: 'IN_REVIEW' } }) : null)
  const segments = asSegments(rec.transcript)
  if (segments.length === 0) {
    await toReview()
    return false
  }
  try {
    const out = await generateCallSummary(segments, buildSpeakerNames(rec.speakers, segments))
    const data = {
      title: out.title,
      summary: out.summary,
      actionItems: out.actionItems as unknown as Prisma.InputJsonValue,
      chapters: out.chapters as unknown as Prisma.InputJsonValue,
      status: 'IN_REVIEW' as const,
      publishedAt: null,
    }
    if (opts.onlyIfEmpty) {
      const res = await prisma.callRecording.updateMany({ where: { id, summary: null }, data })
      return res.count === 1
    }
    await prisma.callRecording.update({ where: { id }, data })
    return true
  } catch (err) {
    console.error('[calls/summary] generation failed:', err instanceof Error ? err.message : err)
    await toReview()
    return false
  }
}

export type PublishResult = 'ok' | 'not-found' | 'not-allowed' | 'incomplete'

/** IN_REVIEW -> PUBLISHED (needs a transcript and a summary). Rejected calls cannot be published. */
export async function publishRecording(id: string, reviewerDiscordId: string, now = new Date()): Promise<PublishResult> {
  const rec = await prisma.callRecording.findUnique({ where: { id }, select: { id: true, status: true, summary: true, transcript: true } })
  if (!rec) return 'not-found'
  if (rec.status === 'PUBLISHED') return 'ok'
  if (rec.status !== 'IN_REVIEW') return 'not-allowed'
  if (!rec.summary?.trim() || asSegments(rec.transcript).length === 0) return 'incomplete'
  await prisma.callRecording.update({
    where: { id },
    data: { status: 'PUBLISHED', reviewedBy: reviewerDiscordId, reviewedAt: now, publishedAt: now },
  })
  return 'ok'
}

/** PUBLISHED -> IN_REVIEW. Nothing is deleted. */
export async function unpublishRecording(id: string, reviewerDiscordId: string, now = new Date()): Promise<PublishResult> {
  const rec = await prisma.callRecording.findUnique({ where: { id }, select: { id: true, status: true } })
  if (!rec) return 'not-found'
  if (rec.status !== 'PUBLISHED') return 'not-allowed'
  await prisma.callRecording.update({
    where: { id },
    data: { status: 'IN_REVIEW', reviewedBy: reviewerDiscordId, reviewedAt: now, publishedAt: null },
  })
  return 'ok'
}

export interface RecordingTextEdit {
  title?: string | null
  summary?: string | null
  actionItems?: Array<{ text: string; owner?: string }>
  chapters?: Array<{ startMs: number; title: string }>
}

export type EditResult = 'ok' | 'not-found' | 'invalid'

/**
 * Reviewer edits. Only the fields present are written. Not allowed on a rejected
 * call; a PUBLISHED call may not lose its title or summary.
 */
export async function updateRecordingText(id: string, edit: RecordingTextEdit): Promise<EditResult> {
  const rec = await prisma.callRecording.findUnique({ where: { id }, select: { id: true, status: true } })
  if (!rec || rec.status === 'REJECTED') return 'not-found'
  if (rec.status === 'PROCESSING') return 'invalid'
  if (rec.status === 'PUBLISHED' && (edit.title === null || edit.summary === null)) return 'invalid'
  const data: Prisma.CallRecordingUpdateInput = {}
  if (edit.title !== undefined) data.title = edit.title
  if (edit.summary !== undefined) data.summary = edit.summary
  if (edit.actionItems !== undefined) data.actionItems = edit.actionItems as unknown as Prisma.InputJsonValue
  if (edit.chapters !== undefined) data.chapters = edit.chapters as unknown as Prisma.InputJsonValue
  if (Object.keys(data).length === 0) return 'ok'
  await prisma.callRecording.update({ where: { id }, data })
  return 'ok'
}

/**
 * Redact one speaker: remove all of their lines from the stored transcript (what the public page
 * renders). Audio and the speaker row are kept. Returns the number of lines removed, or null if the
 * call is unknown, rejected or still processing.
 */
export async function redactSpeakerFromTranscript(id: string, discordId: string): Promise<number | null> {
  const rec = await prisma.callRecording.findUnique({ where: { id }, select: { id: true, status: true, transcript: true } })
  if (!rec || rec.status === 'REJECTED' || rec.status === 'PROCESSING') return null
  const all = asSegments(rec.transcript)
  const kept = all.filter((seg) => seg.discordId !== discordId)
  if (kept.length !== all.length) {
    await prisma.callRecording.update({ where: { id }, data: { transcript: kept as unknown as Prisma.InputJsonValue } })
  }
  return all.length - kept.length
}
