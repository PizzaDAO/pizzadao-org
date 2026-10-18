/**
 * Audio retention: R2 audio is deleted RECORDING_AUDIO_RETENTION_DAYS (default
 * 90) after the call ended. The transcript/summary rows stay; only audio goes.
 * Run daily by /api/cron/call-audio-retention. `audioPastRetention` is the
 * lazy check the signed-URL route uses too, so audio is unreachable the moment
 * it expires even before the sweep runs.
 */
import { prisma } from '@/app/lib/db'
import { deleteRecordingPrefix } from './r2'

export const DEFAULT_RETENTION_DAYS = 90
const DAY_MS = 86_400_000
const BATCH = 50

export function retentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.RECORDING_AUDIO_RETENTION_DAYS)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_RETENTION_DAYS
}

export function retentionCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS)
}

export function audioPastRetention(endedAt: Date, now: Date, days: number): boolean {
  return endedAt.getTime() < retentionCutoff(now, days).getTime()
}

export interface SweepResult {
  checked: number
  deleted: number
  failed: number
  cutoff: string
}

export async function sweepExpiredAudio(
  now = new Date(),
  deps: { deletePrefix: (sessionId: string) => Promise<unknown> } = { deletePrefix: deleteRecordingPrefix },
): Promise<SweepResult> {
  const cutoff = retentionCutoff(now, retentionDays())
  const rows = await prisma.callRecording.findMany({
    where: { audioDeletedAt: null, endedAt: { lt: cutoff } },
    orderBy: { endedAt: 'asc' },
    take: BATCH,
    select: { id: true, sessionId: true },
  })

  let deleted = 0
  let failed = 0
  for (const r of rows) {
    try {
      await deps.deletePrefix(r.sessionId)
      await markAudioDeleted(r.id, now)
      deleted++
    } catch (err) {
      failed++
      console.error('[calls/retention] failed for', r.id, err)
    }
  }
  return { checked: rows.length, deleted, failed, cutoff: cutoff.toISOString() }
}

/** Clear the audio keys and stamp the deletion (after the R2 objects are gone). */
export async function markAudioDeleted(id: string, now = new Date()): Promise<void> {
  await prisma.callRecording.update({
    where: { id },
    data: { audioDeletedAt: now, mixKey: null, speakers: { updateMany: { where: {}, data: { trackKey: null, trackBytes: null } } } },
  })
}
