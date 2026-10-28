/**
 * Re-transcribe a recording that already has a machine transcript (admin tooling, used by
 * scripts/calls/backfill-transcripts.mjs). It resets the transcription fields so the normal pipeline
 * (cron or transcribeRecording) transcribes and summarizes again; it never runs a model itself.
 *
 * Refused for anything a human touched or published: a reviewer-edited summary, a reviewer id, redacted
 * lines or speakers, and PUBLISHED / REJECTED status. Speech line keys change on re-transcription, so
 * redactions could not be carried over. Typed chat lines are kept.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/app/lib/db'
import { asSegments } from './recordings'
import { TRANSCRIBABLE_STATUSES } from './transcribe'

export type RetranscribeResult =
  | { ok: true; dryRun: boolean; speechLines: number; chatLines: number }
  | { ok: false; reason: 'not-found' | 'refused' | 'changed'; details: string[] }

export async function resetForRetranscribe(id: string, opts: { apply?: boolean } = {}): Promise<RetranscribeResult> {
  const rec = await prisma.callRecording.findUnique({
    where: { id },
    select: { status: true, transcript: true, summaryEditedAt: true, reviewedBy: true, redactedSegmentIds: true, redactedSpeakerIds: true, updatedAt: true },
  })
  if (!rec) return { ok: false, reason: 'not-found', details: [] }
  const details: string[] = []
  if (!(TRANSCRIBABLE_STATUSES as readonly string[]).includes(rec.status)) details.push(`status is ${rec.status}`)
  if (rec.summaryEditedAt) details.push('summary was edited by a reviewer')
  if (rec.reviewedBy) details.push('a reviewer has edited this call')
  if ((rec.redactedSegmentIds ?? []).length > 0) details.push('has redacted lines')
  if ((rec.redactedSpeakerIds ?? []).length > 0) details.push('has redacted speakers')
  if (details.length > 0) return { ok: false, reason: 'refused', details }

  const all = asSegments(rec.transcript)
  const chat = all.filter((s) => s.kind === 'chat')
  const counts = { speechLines: all.length - chat.length, chatLines: chat.length }
  if (!opts.apply) return { ok: true, dryRun: true, ...counts }

  // One guarded write: matches nothing if anything changed since the read above.
  const res = await prisma.callRecording.updateMany({
    where: {
      id,
      status: { in: [...TRANSCRIBABLE_STATUSES] },
      summaryEditedAt: null,
      reviewedBy: null,
      redactedSegmentIds: { isEmpty: true },
      redactedSpeakerIds: { isEmpty: true },
      updatedAt: rec.updatedAt,
    },
    data: {
      transcript: chat.length > 0 ? (chat as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      transcribedAt: null,
      transcribeError: null,
      transcribeTracks: Prisma.DbNull,
      transcribeStats: Prisma.DbNull,
      transcribeAttempts: 0,
      summaryError: null,
      summaryAttempts: 0,
    },
  })
  if (res.count !== 1) return { ok: false, reason: 'changed', details: ['the row changed while resetting; nothing was written'] }
  return { ok: true, dryRun: false, ...counts }
}
