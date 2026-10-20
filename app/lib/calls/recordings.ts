/**
 * Call recordings: ingest (worker), review queries (/admin/calls), opt-outs.
 * Audio is private and kept forever; the app never writes or deletes in R2 (see r2.ts).
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/app/lib/db'
import { getCrewMappings } from '@/app/lib/crew-mappings'
import { resolveCrewForEvent, type CrewRef } from './crew-map'
import type { IngestPayload, TranscriptSegment } from './ingest-schema'
import { generateCallSummary } from './summarize'

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
    select: { id: true, mixKey: true, speakers: { select: { trackKey: true } } },
  })
  // The worker deletes any R2 object under the session prefix that is NOT in `keys`
  // (leftovers of earlier attempts), so `keys` is always what the stored row references.
  if (existing) return { id: existing.id, duplicate: true, keys: storedKeys(existing), summarize: false }
  // Opted-out people are never transcribed by the worker; drop their words here too, whatever arrives.
  let segments: TranscriptSegment[] = []
  if (p.transcript?.segments.length) {
    const optedOut = new Set(await listOptOutIds())
    segments = p.transcript.segments.filter((seg) => !optedOut.has(seg.discordId))
  }
  const hasTranscript = segments.length > 0
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
 * stored transcript and move a fresh call to IN_REVIEW. Never publishes and
 * never changes the status of a PUBLISHED or REJECTED call. A model failure
 * leaves the transcript in place and the call in review so a reviewer can retry.
 */
export async function generateAndStoreSummary(id: string): Promise<boolean> {
  const rec = await prisma.callRecording.findUnique({
    where: { id },
    select: { id: true, status: true, transcript: true, speakers: { select: { discordId: true, displayName: true } } },
  })
  if (!rec) return false
  const fresh = rec.status === 'PROCESSING' || rec.status === 'RECORDED'
  const toReview = () => (fresh ? prisma.callRecording.update({ where: { id }, data: { status: 'IN_REVIEW' } }) : null)
  const segments = asSegments(rec.transcript)
  if (segments.length === 0) {
    await toReview()
    return false
  }
  try {
    const names = Object.fromEntries(rec.speakers.map((s) => [s.discordId, s.displayName ?? s.discordId]))
    const out = await generateCallSummary(segments, names)
    await prisma.callRecording.update({
      where: { id },
      data: {
        title: out.title,
        summary: out.summary,
        actionItems: out.actionItems as unknown as Prisma.InputJsonValue,
        chapters: out.chapters as unknown as Prisma.InputJsonValue,
        ...(fresh ? { status: 'IN_REVIEW' as const } : {}),
      },
    })
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

/** Reviewer edits of the generated title and summary. Not allowed on a rejected call. */
export async function updateRecordingText(id: string, data: { title: string | null; summary: string | null }): Promise<boolean> {
  const rec = await prisma.callRecording.findUnique({ where: { id }, select: { id: true, status: true } })
  if (!rec || rec.status === 'REJECTED') return false
  await prisma.callRecording.update({ where: { id }, data: { title: data.title, summary: data.summary } })
  return true
}
