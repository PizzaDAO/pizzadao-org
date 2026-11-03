/**
 * Attendance from recorded Discord calls (setting calls.attendanceFromRecordings, off by default).
 *
 * A recording counts everyone the recorder saw in the voice channel (participantIds, silent attendees
 * included) plus everyone who spoke, for the recording's crew and the call's day. Rows land in
 * CallAttendance with source "recording" and the synthetic dailySheetId `rec:<crew>:<day>`, so:
 *   - the second part of a call split in two collapses onto the same row (unique per person and day-key);
 *   - a person the daily sheet already counted that day is skipped (never double counted, never overwritten);
 *   - nothing is ever deleted or updated.
 * Imported (non-Discord) recordings count only when they carry participant ids.
 */
import { prisma } from '@/app/lib/db'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { rebuildAttendanceSummaries } from '@/app/lib/attendance'
import { isImportedSource } from './imported'

const DISCORD_ID = /^\d{17,20}$/
/** Calls are scheduled on US Eastern evenings: the day is the Eastern calendar day, stored as midnight UTC like the sheet dates. */
const DAY_ZONE = 'America/New_York'

export async function attendanceFromRecordingsEnabled(): Promise<boolean> {
  return toggleEnabled('calls.attendanceFromRecordings')
}

/** The call's day as midnight UTC of its Eastern calendar date. */
export function callDay(startedAt: Date): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: DAY_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(startedAt)
  return new Date(`${ymd}T00:00:00.000Z`)
}

export function recordingAttendanceKey(crewId: string, day: Date): string {
  return `rec:${crewId}:${day.toISOString().slice(0, 10)}`
}

export interface AttendanceRecordingInput {
  source: string | null
  participantIds: string[]
  speakers: Array<{ discordId: string; displayName: string | null; talkTimeSec: number }>
}

/** Pure: who should be counted, as a discordId -> display name map (null when unknown). */
export function attendeesOf(r: AttendanceRecordingInput): Map<string, string | null> {
  const out = new Map<string, string | null>()
  if (isImportedSource(r.source) && r.participantIds.length === 0) return out
  const names = new Map(r.speakers.map((s) => [s.discordId, s.displayName]))
  const ids = [...r.participantIds, ...r.speakers.filter((s) => s.talkTimeSec > 0).map((s) => s.discordId)]
  for (const id of ids) if (DISCORD_ID.test(id)) out.set(id, names.get(id) ?? null)
  return out
}

export interface RecordingAttendanceResult {
  recordingId: string
  skipped?: 'no-crew' | 'no-attendees' | 'imported'
  attendees: number
  /** Rows written (or, in a dry run, that would be written). */
  created: number
}

/**
 * Write (or, with dryRun, count) the attendance rows for one recording. Idempotent.
 * `planned` lets a dry run over several recordings avoid counting one person twice for the same crew and day.
 */
export async function recordAttendanceForRecording(
  recordingId: string,
  opts: { dryRun?: boolean; planned?: Set<string> } = {},
): Promise<RecordingAttendanceResult> {
  const rec = await prisma.callRecording.findUnique({
    where: { id: recordingId },
    select: {
      crewId: true,
      crewLabel: true,
      startedAt: true,
      source: true,
      participantIds: true,
      status: true,
      speakers: { select: { discordId: true, displayName: true, talkTimeSec: true } },
    },
  })
  const base = { recordingId, attendees: 0, created: 0 }
  if (!rec || !rec.crewId || rec.status === 'REJECTED') return { ...base, skipped: 'no-crew' }
  const attendees = attendeesOf(rec)
  if (attendees.size === 0) return { ...base, skipped: isImportedSource(rec.source) ? 'imported' : 'no-attendees' }

  const crewId = rec.crewId
  const day = callDay(rec.startedAt)
  const key = recordingAttendanceKey(crewId, day)
  const ids = [...attendees.keys()]
  // Already counted that day for this crew (by the sheet or by the first part of this call).
  const existing = await prisma.callAttendance.findMany({ where: { crewId, callDate: day, discordId: { in: ids } }, select: { discordId: true } })
  const have = new Set(existing.map((e) => e.discordId))
  const fresh = ids.filter((id) => !have.has(id) && !opts.planned?.has(`${key}|${id}`))
  if (opts.dryRun) {
    for (const id of fresh) opts.planned?.add(`${key}|${id}`)
    return { recordingId, attendees: ids.length, created: fresh.length }
  }
  if (fresh.length === 0) return { recordingId, attendees: ids.length, created: 0 }

  const res = await prisma.callAttendance.createMany({
    data: fresh.map((discordId) => ({
      discordId,
      displayName: attendees.get(discordId) ?? null,
      crewId,
      crewLabel: rec.crewLabel ?? crewId,
      callDate: day,
      dailySheetId: key,
      source: 'recording',
    })),
    skipDuplicates: true,
  })
  if (res.count > 0) await rebuildAttendanceSummaries(fresh).catch((e) => console.error('[calls/attendance] summary rebuild failed:', e instanceof Error ? e.message : e))
  return { recordingId, attendees: ids.length, created: res.count }
}

/** Ingest hook: never throws, does nothing while the setting is off. */
export async function recordAttendanceOnIngest(recordingId: string): Promise<void> {
  try {
    if (!(await attendanceFromRecordingsEnabled())) return
    await recordAttendanceForRecording(recordingId)
  } catch (err) {
    console.error('[calls/attendance] failed:', err instanceof Error ? err.message : err)
  }
}

export const BACKFILL_MAX_DAYS = 120
export const BACKFILL_MAX_RECORDINGS = 200

/** Recent recordings that have a crew, oldest first so a split call's parts are handled in order. */
export async function backfillAttendance(opts: { days: number; dryRun: boolean }) {
  const days = Math.min(Math.max(Math.trunc(opts.days) || 1, 1), BACKFILL_MAX_DAYS)
  const since = new Date(Date.now() - days * 86_400_000)
  const rows = await prisma.callRecording.findMany({
    where: { crewId: { not: null }, startedAt: { gte: since }, status: { not: 'REJECTED' } },
    select: { id: true },
    orderBy: { startedAt: 'asc' },
    take: BACKFILL_MAX_RECORDINGS,
  })
  const planned = new Set<string>()
  const results: RecordingAttendanceResult[] = []
  for (const { id } of rows) results.push(await recordAttendanceForRecording(id, { dryRun: opts.dryRun, planned }))
  return { dryRun: opts.dryRun, days, recordings: rows.length, created: results.reduce((n, r) => n + r.created, 0), results }
}
