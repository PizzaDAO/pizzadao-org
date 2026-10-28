/**
 * Call recordings: ingest (worker), review queries (/admin/calls).
 * Audio is private and kept forever; the app never writes or deletes in R2 (see r2.ts).
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/app/lib/db'
import { getCrewMappings } from '@/app/lib/crew-mappings'
import { resolveCrewForEvent, type CrewRef } from './crew-map'
import type { IngestPayload, TranscriptSegment } from './ingest-schema'
import { chatOnlyAuthors, mergeChat, publicChatText, segmentKey } from './chat'
import { buildSpeakerNames, DEFAULT_SUMMARY_BUDGET_MS, generateCallSummary } from './summarize'

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
export async function ingestRecording(p: IngestPayload): Promise<{ id: string; duplicate: boolean; keys: string[]; summarize: boolean; transcribe: boolean }> {
  const existing = await prisma.callRecording.findUnique({
    where: { sessionId: p.sessionId },
    select: { id: true, status: true, mixKey: true, speakers: { select: { trackKey: true } } },
  })
  // Everyone in the call is recorded and transcribed (no opt-out since 2026-10-25); reviewers hide speakers per call.
  // Voice-channel chat lines are stored in the same JSON (kind: 'chat'), so chat alone also counts as content.
  const segments: TranscriptSegment[] = mergeChat(p.transcript?.segments ?? [], p.chat)
  const hasTranscript = segments.length > 0
  // Chat authors who never spoke still get a speaker row (no audio) so a reviewer can hide them.
  const chatAuthors = chatOnlyAuthors(p.chat, p.speakers.map((s) => s.discordId))
  // The worker deletes any R2 object under the session prefix that is NOT in `keys`
  // (leftovers of earlier attempts), so `keys` is always what the stored row references.
  if (existing) {
    // A retry may carry a transcript the first ingest lacked (e.g. Deepgram was down). Fill it in only
    // while the row is still untouched (RECORDED, no transcript); anything else stays as the reviewer left it.
    let filled = false
    if (hasTranscript && existing.status === 'RECORDED') {
      // One transaction: the transcript and the chat-only speaker rows land together or not at all.
      filled = await prisma.$transaction(async (tx) => {
        const res = await tx.callRecording.updateMany({
          where: { id: existing.id, status: 'RECORDED', transcript: { equals: Prisma.DbNull } },
          data: {
            transcript: segments as unknown as Prisma.InputJsonValue,
            transcriptLanguage: p.transcript?.language ?? null,
            status: 'PROCESSING',
            // A worker-provided spoken transcript must never be replaced by server-side transcription.
            ...((p.transcript?.segments.length ?? 0) > 0 ? { transcribedAt: new Date() } : {}),
          },
        })
        if (res.count === 1 && chatAuthors.length > 0) {
          await tx.callSpeaker.createMany({
            data: chatAuthors.map((a) => ({ recordingId: existing.id, discordId: a.discordId, displayName: a.displayName, talkTimeSec: 0 })),
            skipDuplicates: true,
          })
        }
        return res.count === 1
      })
    }
    return { id: existing.id, duplicate: true, keys: storedKeys(existing), summarize: filled, transcribe: false }
  }
  const hasSpeech = (p.transcript?.segments.length ?? 0) > 0
  // No spoken transcript from the worker but there are speaker tracks: the app transcribes them (cron + after()).
  const needsTranscription = !hasSpeech && p.speakers.some((sp) => sp.trackKey && sp.talkTimeSec > 0)
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
      ...(hasSpeech ? { transcribedAt: new Date() } : {}),
      ...(hasTranscript
        ? { transcript: segments as unknown as Prisma.InputJsonValue, transcriptLanguage: p.transcript?.language ?? null, status: 'PROCESSING' as const }
        : {}),
      speakers: {
        create: [
          ...p.speakers.map((s) => ({
            discordId: s.discordId,
            displayName: s.displayName,
            talkTimeSec: s.talkTimeSec,
            trackKey: s.trackKey,
            trackBytes: s.trackBytes,
          })),
          ...chatAuthors.map((a) => ({ discordId: a.discordId, displayName: a.displayName, talkTimeSec: 0, trackKey: null, trackBytes: null })),
        ],
      },
    },
    select: { id: true },
  })
  return {
    id: created.id,
    duplicate: false,
    keys: storedKeys({ mixKey: p.mix?.key ?? null, speakers: p.speakers.map((s) => ({ trackKey: s.trackKey })) }),
    summarize: hasTranscript,
    transcribe: needsTranscription,
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
  const rec = await prisma.callRecording.findFirst({
    where: { id, status: 'PUBLISHED' },
    select: { ...PUBLIC_SELECT, redactedSpeakerIds: true, redactedSegmentIds: true },
  })
  if (!rec) return null
  // Redaction is applied here, server-side: redacted lines and speakers never reach the page.
  const { redactedSpeakerIds, redactedSegmentIds, ...pub } = rec
  const hidden = new Set(redactedSpeakerIds ?? [])
  return {
    ...pub,
    transcript: visibleSegments(rec.transcript, redactedSpeakerIds, redactedSegmentIds).map((seg) =>
      seg.kind === 'chat' ? { ...seg, text: publicChatText(seg.text) } : seg,
    ),
    speakers: rec.speakers.filter((s) => !hidden.has(s.discordId)),
  }
}

export function asSegments(v: unknown): TranscriptSegment[] {
  return Array.isArray(v) ? (v as TranscriptSegment[]) : []
}

/** The transcript without redacted speakers' lines (what the public page and the model may see). */
export function visibleSegments(
  transcript: unknown,
  redactedSpeakerIds: readonly string[] | null | undefined,
  redactedSegmentIds?: readonly string[] | null,
): TranscriptSegment[] {
  const hidden = new Set(redactedSpeakerIds ?? [])
  const hiddenLines = new Set(redactedSegmentIds ?? [])
  return asSegments(transcript).filter((seg) => !hidden.has(seg.discordId) && !hiddenLines.has(segmentKey(seg)))
}

/** Error text safe to store and show: URLs removed, one line, at most 300 characters. */
export function sanitizeSummaryError(message: string): string {
  return message
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/Bearer\s+\S+/gi, '')
    .replace(/sk-[A-Za-z0-9_*.-]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 300) || 'summary generation failed'
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
export type SummaryResult = 'ok' | 'skipped' | 'failed'

export async function generateAndStoreSummary(id: string, opts: SummaryOptions = {}): Promise<boolean> {
  return (await generateAndStoreSummaryResult(id, opts)) === 'ok'
}

export interface SummaryOptions {
  onlyIfEmpty?: boolean
  unlessEdited?: boolean
  /** Time left in the surrounding function run; the model calls are aborted to fit (default 180 s). */
  budgetMs?: number
}

/** Like generateAndStoreSummary, but tells a deliberate skip (nothing to write, guarded write matched nothing) from a failure. */
export async function generateAndStoreSummaryResult(id: string, opts: SummaryOptions = {}): Promise<SummaryResult> {
  // Taken BEFORE the row is read: a redaction made while the model runs is stamped later than this, so it still counts as newer than the summary.
  const startedAt = new Date()
  const rec = await prisma.callRecording.findUnique({
    where: { id },
    select: { id: true, status: true, transcript: true, redactedSpeakerIds: true, redactedSegmentIds: true, speakers: { select: { discordId: true, displayName: true } } },
  })
  if (!rec || rec.status === 'REJECTED') return 'skipped'
  // Never leave a fresh row stuck in PROCESSING/RECORDED; never touch a row rejected meanwhile.
  const toReview = () => prisma.callRecording.updateMany({ where: { id, status: { in: ['PROCESSING', 'RECORDED'] } }, data: { status: 'IN_REVIEW' } })
  const segments = visibleSegments(rec.transcript, rec.redactedSpeakerIds, rec.redactedSegmentIds)
  if (segments.length === 0) {
    // Nothing to summarize: count it as an attempt so the retry sweep gives up instead of looking at this row forever.
    await prisma.callRecording.updateMany({ where: { id, summary: null, summaryEditedAt: null }, data: { summaryError: 'no transcript text to summarize', summaryAttempts: { increment: 1 } } }).catch(() => {})
    await toReview()
    return 'failed'
  }
  // Claim an attempt BEFORE the model call: if the function is killed mid-call, the attempt is still counted and the sweep cannot loop forever.
  await prisma.callRecording.updateMany({ where: { id, summary: null, summaryEditedAt: null }, data: { summaryAttempts: { increment: 1 } } }).catch(() => {})
  try {
    const out = await generateCallSummary(segments, buildSpeakerNames(rec.speakers, segments), undefined, { budgetMs: opts.budgetMs ?? DEFAULT_SUMMARY_BUDGET_MS })
    const data = {
      title: out.title,
      summary: out.summary,
      actionItems: out.actionItems as unknown as Prisma.InputJsonValue,
      chapters: out.chapters as unknown as Prisma.InputJsonValue,
      status: 'IN_REVIEW' as const,
      publishedAt: null,
      summaryGeneratedAt: startedAt,
      summaryEditedAt: null,
      summaryError: null,
    }
    // REJECTED is excluded in the WHERE, so a reject that lands during generation stays rejected.
    // unlessEdited: automatic runs never replace text a reviewer edited (summaryEditedAt), even if the edit landed mid-generation.
    const where = {
      id,
      // Automatic runs (unlessEdited) also leave PUBLISHED rows alone: publishing a call freezes its public text.
      status: opts.unlessEdited ? { notIn: ['REJECTED' as const, 'PUBLISHED' as const] } : { not: 'REJECTED' as const },
      ...(opts.onlyIfEmpty ? { summary: null } : {}),
      ...(opts.unlessEdited ? { summaryEditedAt: null } : {}),
    }
    const res = await prisma.callRecording.updateMany({ where, data })
    if (res.count === 1) return 'ok'
    // Matched nothing (a summary appeared meanwhile, a reviewer edited, or the call was rejected/published): a deliberate skip, not a failure. Still unstick a fresh row.
    console.log('[calls/summary] skipped: guarded write matched nothing')
    await toReview()
    return 'skipped'
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[calls/summary] generation failed:', message)
    // Remember why (and how often) so the admin page shows it and the cron sweep can retry with a cap. Never touches a row that already has a summary.
    await prisma.callRecording
      .updateMany({ where: { id, summary: null, summaryEditedAt: null }, data: { summaryError: sanitizeSummaryError(message) } })
      .catch(() => {})
    await toReview()
    return 'failed'
  }
}

/** How far back the transcription cron looks (rows reset by the re-transcribe tool are picked up whatever their age). */
export const PENDING_WINDOW_DAYS = 14

export type PublishResult = 'ok' | 'already' | 'not-found' | 'not-allowed' | 'incomplete' | 'transcribing' | 'conflict'

/** IN_REVIEW -> PUBLISHED (needs a transcript and a summary). Rejected calls cannot be published. */
export async function publishRecording(id: string, reviewerDiscordId: string, now = new Date()): Promise<PublishResult> {
  const rec = await prisma.callRecording.findUnique({ where: { id }, select: { id: true, status: true, summary: true, transcript: true, redactedSpeakerIds: true, redactedSegmentIds: true, transcribedAt: true, transcribeAttempts: true, startedAt: true, retranscribeRequestedAt: true, updatedAt: true, speakers: { select: { discordId: true, trackKey: true, talkTimeSec: true } } } })
  if (!rec) return 'not-found'
  if (rec.status === 'PUBLISHED') return 'already'
  if (rec.status !== 'IN_REVIEW') return 'not-allowed'
  // Not while a (re-)transcription is still due: the public text would be a partial or stale transcript. A call automatic transcription gave up on (3 attempts) can still be published by hand.
  const hidden = new Set(rec.redactedSpeakerIds ?? [])
  const transcribable = (rec.speakers ?? []).some((sp) => !!sp.trackKey && sp.talkTimeSec > 0 && !hidden.has(sp.discordId))
  const hasSpeech = asSegments(rec.transcript).some((s) => s.kind !== 'chat')
  // Only when the cron will really pick the row up (inside its window or flagged by the tool, and OpenAI configured); otherwise waiting would block publishing forever.
  const cronWillRun = !!process.env.OPENAI_API_KEY?.trim() && (!!rec.retranscribeRequestedAt || (rec.startedAt?.getTime() ?? 0) >= now.getTime() - PENDING_WINDOW_DAYS * 86_400_000)
  if (!rec.transcribedAt && transcribable && !hasSpeech && (rec.transcribeAttempts ?? 0) < 3 && cronWillRun) return 'transcribing'
  if (!rec.summary?.trim() || visibleSegments(rec.transcript, rec.redactedSpeakerIds, rec.redactedSegmentIds).length === 0) return 'incomplete'
  // Guarded on the row we just checked: if anything changed meanwhile (a redaction, a regenerated summary, a transcript), nothing is published.
  const res = await prisma.callRecording.updateMany({
    where: { id, status: 'IN_REVIEW', updatedAt: rec.updatedAt },
    data: { status: 'PUBLISHED', reviewedBy: reviewerDiscordId, reviewedAt: now, publishedAt: now },
  })
  return res.count === 1 ? 'ok' : 'conflict'
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
  const rec = await prisma.callRecording.findUnique({ where: { id }, select: { id: true, status: true, summary: true, actionItems: true, chapters: true } })
  if (!rec || rec.status === 'REJECTED') return 'not-found'
  if (rec.status === 'PROCESSING') return 'invalid'
  if (rec.status === 'PUBLISHED' && (edit.title === null || edit.summary === null)) return 'invalid'
  const data: Prisma.CallRecordingUpdateInput = {}
  // A reviewer's words: automatic transcription/summary runs must never overwrite them.
  // Only a real change of the summary / action items / chapters text counts (a title-only or no-op save does not).
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  const textChanged =
    (edit.summary !== undefined && !same(rec.summary, edit.summary)) ||
    (edit.actionItems !== undefined && !same(rec.actionItems ?? [], edit.actionItems)) ||
    (edit.chapters !== undefined && !same(rec.chapters ?? [], edit.chapters))
  if (textChanged) data.summaryEditedAt = new Date()
  if (edit.title !== undefined) data.title = edit.title
  if (edit.summary !== undefined) data.summary = edit.summary
  if (edit.actionItems !== undefined) data.actionItems = edit.actionItems as unknown as Prisma.InputJsonValue
  if (edit.chapters !== undefined) data.chapters = edit.chapters as unknown as Prisma.InputJsonValue
  if (Object.keys(data).length === 0) return 'ok'
  await prisma.callRecording.update({ where: { id }, data })
  return 'ok'
}

/**
 * Hide (or restore) one speaker's lines. Non-destructive: the stored transcript, audio and speaker
 * rows are untouched; the id is added to / removed from `redactedSpeakerIds`, which the public page
 * and the summary model respect. Returns how many lines the speaker has, or null if the call is
 * unknown, rejected or still processing.
 */
export async function setSpeakerRedacted(id: string, discordId: string, redacted: boolean): Promise<number | null> {
  const rec = await prisma.callRecording.findUnique({ where: { id }, select: { id: true, status: true, transcript: true, redactedSpeakerIds: true } })
  if (!rec || rec.status === 'REJECTED' || rec.status === 'PROCESSING') return null
  const current = rec.redactedSpeakerIds ?? []
  const next = redacted ? (current.includes(discordId) ? current : [...current, discordId]) : current.filter((x) => x !== discordId)
  if (next.length !== current.length) {
    // On a PUBLISHED call the public text changes, so it goes back to review before it can be republished.
    await prisma.callRecording.update({
      where: { id },
      data: { redactedSpeakerIds: next, redactionsUpdatedAt: new Date(), ...(rec.status === 'PUBLISHED' ? { status: 'IN_REVIEW' as const, publishedAt: null } : {}) },
    })
  }
  return asSegments(rec.transcript).filter((seg) => seg.discordId === discordId).length
}

/**
 * Hide (or restore) ONE transcript line (a chat message or a spoken turn) by its segment key.
 * Non-destructive like speaker redaction: the key goes into `redactedSegmentIds`. A PUBLISHED call goes
 * back to review. Returns false when the call or the line is unknown, rejected or processing.
 */
export async function setSegmentRedacted(id: string, key: string, redacted: boolean): Promise<boolean> {
  const rec = await prisma.callRecording.findUnique({ where: { id }, select: { id: true, status: true, transcript: true, redactedSegmentIds: true } })
  if (!rec || rec.status === 'REJECTED' || rec.status === 'PROCESSING') return false
  if (!asSegments(rec.transcript).some((seg) => segmentKey(seg) === key)) return false
  const current = rec.redactedSegmentIds ?? []
  const next = redacted ? (current.includes(key) ? current : [...current, key]) : current.filter((x) => x !== key)
  if (next.length !== current.length) {
    await prisma.callRecording.update({
      where: { id },
      data: { redactedSegmentIds: next, redactionsUpdatedAt: new Date(), ...(rec.status === 'PUBLISHED' ? { status: 'IN_REVIEW' as const, publishedAt: null } : {}) },
    })
  }
  return true
}
