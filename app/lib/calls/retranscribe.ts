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
import { DISCORD_ONLY, isImportedSource } from './imported'

export type RetranscribeResult =
  | { ok: true; dryRun: boolean; speechLines: number; chatLines: number; tracks: number }
  | { ok: false; reason: 'not-found' | 'refused' | 'changed' | 'not-supported'; details: string[] }

export async function resetForRetranscribe(id: string, opts: { apply?: boolean; forceWorker?: boolean } = {}): Promise<RetranscribeResult> {
  const rec = await prisma.callRecording.findUnique({
    where: { id },
    select: { status: true, source: true, transcript: true, summaryEditedAt: true, reviewedBy: true, transcribeStats: true, speakers: { select: { discordId: true, trackKey: true, talkTimeSec: true } }, redactedSegmentIds: true, redactedSpeakerIds: true, updatedAt: true },
  })
  if (!rec) return { ok: false, reason: 'not-found', details: [] }
  // An imported call has no audio tracks for the app to redo this from: resetting it would only destroy the transcript. Re-run the import tool instead.
  if (isImportedSource(rec.source)) return { ok: false, reason: 'not-supported', details: ['imported call: re-run the import tool with --force instead'] }
  const details: string[] = []
  if (!(TRANSCRIBABLE_STATUSES as readonly string[]).includes(rec.status)) details.push(`status is ${rec.status}`)
  if (rec.summaryEditedAt) details.push('summary was edited by a reviewer')
  if (rec.reviewedBy) details.push('a reviewer has edited this call')
  if ((rec.redactedSegmentIds ?? []).length > 0) details.push('has redacted lines')
  if ((rec.redactedSpeakerIds ?? []).length > 0) details.push('has redacted speakers')

  const hidden = new Set(rec.redactedSpeakerIds ?? [])
  const tracks = (rec.speakers ?? []).filter((sp) => !!sp.trackKey && sp.talkTimeSec > 0 && !hidden.has(sp.discordId)).length
  // Without audio tracks the pipeline could not rebuild the speech this reset deletes.
  if (tracks === 0) details.push('no non-redacted speaker has an audio track with talk time, so nothing could be re-transcribed')

  const all = asSegments(rec.transcript)
  const chat = all.filter((s) => s.kind === 'chat')
  const counts = { speechLines: all.length - chat.length, chatLines: chat.length, tracks }
  // Speech with no transcribeStats did not come from the server pipeline this tool re-runs (it may be the recorder worker's own transcript).
  if (counts.speechLines > 0 && !rec.transcribeStats && !opts.forceWorker) {
    details.push('spoken lines have no server transcription stats (possibly a recorder-provided transcript); pass --force-worker to replace them anyway')
  }
  if (details.length > 0) return { ok: false, reason: 'refused', details }
  if (!opts.apply) return { ok: true, dryRun: true, ...counts }

  // One guarded write: matches nothing if anything changed since the read above.
  const res = await prisma.callRecording.updateMany({
    where: {
      id,
      ...DISCORD_ONLY,
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
      retranscribeRequestedAt: new Date(),
      summaryError: null,
      summaryAttempts: 0,
    },
  })
  if (res.count !== 1) return { ok: false, reason: 'changed', details: ['the row changed while resetting; nothing was written'] }
  return { ok: true, dryRun: false, ...counts }
}
