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
import { loadSettings } from '@/app/lib/settings'
import { rebuildAttendanceSummaries } from '@/app/lib/attendance'
import { attendanceCrewId, crewIdsFor, loadCrewAliases } from './crew-alias'
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

function humanizeCrewId(id: string): string {
  return id.split(/[_-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')
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

export interface AttendanceThresholds {
  minMinutes: number
  shortCallPercent: number
  speakersAlwaysCount: boolean
}

export const DEFAULT_THRESHOLDS: AttendanceThresholds = { minMinutes: 5, shortCallPercent: 50, speakersAlwaysCount: true }

export interface CountedRecording extends AttendanceRecordingInput {
  durationSec: number
  presence: Array<{ discordId: string; presentSec: number }>
}

export interface CountedAttendee {
  name: string | null
  /** Seconds in the channel summed over the day's recordings; null when no recording measured this person (old rule). */
  presentSec: number | null
}

/** Seconds a person must be present: the minimum, or the short-call share of the call when the call is under twice the minimum. */
export function thresholdSec(totalDurationSec: number, t: AttendanceThresholds): number {
  const min = Math.max(0, t.minMinutes) * 60
  if (min === 0) return 0
  if (totalDurationSec < 2 * min) return Math.floor((totalDurationSec * Math.min(100, Math.max(0, t.shortCallPercent))) / 100)
  return min
}

/**
 * Pure: everyone counted for one crew and day, across all its recordings (split calls are common), as
 * discordId -> { name, presentSec }. Recordings with presence data are measured against the threshold;
 * recordings without it use the old rule (everyone seen plus every speaker).
 */
export function countedAttendees(recordings: CountedRecording[], t: AttendanceThresholds): Map<string, CountedAttendee> {
  const out = new Map<string, CountedAttendee>()
  const measured = new Map<string, number>()
  const names = new Map<string, string | null>()
  const speakers = new Set<string>()
  const measuredIds = new Set<string>()
  let total = 0
  for (const r of recordings) {
    if (r.presence.length === 0) {
      // Old rule: no presence was measured for this recording.
      for (const [id, name] of attendeesOf(r)) {
        const have = out.get(id)
        if (!have) out.set(id, { name, presentSec: null })
        else if (!have.name && name) have.name = name
      }
      continue
    }
    total += Math.max(0, r.durationSec)
    for (const p of r.presence) {
      if (!DISCORD_ID.test(p.discordId)) continue
      measured.set(p.discordId, (measured.get(p.discordId) ?? 0) + p.presentSec)
      measuredIds.add(p.discordId)
    }
    for (const sp of r.speakers) {
      if (!names.get(sp.discordId)) names.set(sp.discordId, sp.displayName)
      if (sp.talkTimeSec > 0 && DISCORD_ID.test(sp.discordId)) speakers.add(sp.discordId)
    }
    for (const id of r.participantIds) if (DISCORD_ID.test(id)) measuredIds.add(id)
  }
  const need = thresholdSec(total, t)
  for (const id of measuredIds) {
    const sec = measured.get(id) ?? 0
    if (sec >= need || (t.speakersAlwaysCount && speakers.has(id))) out.set(id, { name: names.get(id) ?? out.get(id)?.name ?? null, presentSec: sec })
  }
  if (t.speakersAlwaysCount) {
    for (const id of speakers) if (!out.has(id)) out.set(id, { name: names.get(id) ?? null, presentSec: measured.get(id) ?? 0 })
  }
  return out
}

export async function loadAttendanceThresholds(): Promise<AttendanceThresholds> {
  try {
    const s = await loadSettings()
    return {
      minMinutes: s.get('calls.attendanceMinMinutes'),
      shortCallPercent: s.get('calls.attendanceShortCallPercent'),
      speakersAlwaysCount: s.get('calls.attendanceSpeakersAlwaysCount'),
    }
  } catch {
    return DEFAULT_THRESHOLDS
  }
}

export interface RecordingAttendanceResult {
  recordingId: string
  skipped?: 'no-crew' | 'no-attendees' | 'imported'
  attendees: number
  /** Rows written (or, in a dry run, that would be written). */
  created: number
}

/**
 * Write (or, with dryRun, count) the attendance rows for one recording's crew and day. Idempotent.
 * The whole day is evaluated together (all recordings of the crew that Eastern day), so minutes add up across a split call.
 * `planned` lets a dry run over several recordings avoid counting one person twice for the same crew and day.
 */
export async function recordAttendanceForRecording(
  recordingId: string,
  opts: { dryRun?: boolean; planned?: Set<string>; skipSummary?: boolean; createdIds?: Set<string>; thresholds?: AttendanceThresholds } = {},
): Promise<RecordingAttendanceResult> {
  const select = {
    id: true,
    crewId: true,
    crewLabel: true,
    startedAt: true,
    durationSec: true,
    source: true,
    participantIds: true,
    status: true,
    speakers: { select: { discordId: true, displayName: true, talkTimeSec: true } },
    presence: { select: { discordId: true, presentSec: true } },
  } as const
  const rec = await prisma.callRecording.findUnique({ where: { id: recordingId }, select })
  const base = { recordingId, attendees: 0, created: 0 }
  if (!rec || !rec.crewId || rec.status === 'REJECTED') return { ...base, skipped: 'no-crew' }

  const aliases = await loadCrewAliases()
  const crewId = attendanceCrewId(rec.crewId, aliases)
  const crewLabel = crewId === rec.crewId ? (rec.crewLabel ?? crewId) : humanizeCrewId(crewId)
  const day = callDay(rec.startedAt)
  const key = recordingAttendanceKey(crewId, day)
  const crewIds = crewIdsFor(crewId, aliases)

  // Every recording of this crew and day (a call can be split in several parts).
  const around = await prisma.callRecording.findMany({
    where: { crewId: { in: crewIds }, status: { not: 'REJECTED' }, startedAt: { gte: day, lt: new Date(day.getTime() + 2 * 86_400_000) } },
    select,
  })
  const sameDay = [rec, ...around.filter((r) => r.id !== rec.id)].filter((r) => callDay(r.startedAt).getTime() === day.getTime())
  const thresholds = opts.thresholds ?? (await loadAttendanceThresholds())
  const counted = countedAttendees(sameDay, thresholds)
  if (counted.size === 0) return { ...base, skipped: isImportedSource(rec.source) ? 'imported' : 'no-attendees' }

  const ids = [...counted.keys()]
  // Already counted that day for this crew (by the sheet, an admin or an earlier part of this call).
  const existing = await prisma.callAttendance.findMany({
    where: { crewId: { in: crewIds }, callDate: day, discordId: { in: ids } },
    select: { id: true, discordId: true, source: true, presentSec: true },
  })
  const have = new Set(existing.map((e) => e.discordId))
  // An admin removed them for this crew and day (the latest edit wins): do not add them back.
  const edits = await prisma.attendanceEdit.findMany({
    where: { crewId: { in: crewIds }, callDate: day, discordId: { in: ids } },
    select: { discordId: true, action: true },
    orderBy: { id: 'asc' },
  })
  const latest = new Map<string, string>()
  for (const e of edits) latest.set(e.discordId, e.action)
  const fresh = ids.filter((id) => !have.has(id) && latest.get(id) !== 'remove' && !opts.planned?.has(`${key}|${id}`))
  // Minutes on existing recording rows follow the whole day's total.
  const refresh = existing.filter((e) => e.source === 'recording' && counted.get(e.discordId)?.presentSec != null && counted.get(e.discordId)!.presentSec !== e.presentSec)
  if (opts.dryRun) {
    for (const id of fresh) opts.planned?.add(`${key}|${id}`)
    return { recordingId, attendees: ids.length, created: fresh.length }
  }
  for (const e of refresh) {
    await prisma.callAttendance.update({ where: { id: e.id }, data: { presentSec: counted.get(e.discordId)!.presentSec } })
  }
  if (fresh.length === 0) return { recordingId, attendees: ids.length, created: 0 }

  const res = await prisma.callAttendance.createMany({
    data: fresh.map((discordId) => ({
      discordId,
      displayName: counted.get(discordId)?.name ?? null,
      crewId,
      crewLabel,
      callDate: day,
      dailySheetId: key,
      source: 'recording',
      presentSec: counted.get(discordId)?.presentSec ?? null,
      recordingId,
    })),
    skipDuplicates: true,
  })
  if (res.count > 0) for (const id of fresh) opts.createdIds?.add(id)
  if (res.count > 0 && !opts.skipSummary) await rebuildAttendanceSummaries(fresh).catch((e) => console.error('[calls/attendance] summary rebuild failed:', e instanceof Error ? e.message : e))
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
/** Stop starting new recordings after this long so one run stays inside the route's maxDuration. */
const BACKFILL_BUDGET_MS = 40_000

/**
 * Recent recordings that have a crew, newest first. `before` (an ISO date, the `nextBefore` of the previous run)
 * continues past the 200-per-run cap; recordings already fully counted just report 0 created. Summaries are
 * rebuilt once at the end of a real run.
 */
export async function backfillAttendance(opts: { days: number; dryRun: boolean; before?: Date | null }) {
  const started = Date.now()
  const days = Math.min(Math.max(Math.trunc(opts.days) || 1, 1), BACKFILL_MAX_DAYS)
  const since = new Date(started - days * 86_400_000)
  const rows = await prisma.callRecording.findMany({
    where: { crewId: { not: null }, startedAt: { gte: since, ...(opts.before ? { lt: opts.before } : {}) }, status: { not: 'REJECTED' } },
    select: { id: true, startedAt: true },
    orderBy: { startedAt: 'desc' },
    take: BACKFILL_MAX_RECORDINGS,
  })
  const planned = new Set<string>()
  const createdIds = new Set<string>()
  const results: RecordingAttendanceResult[] = []
  let last: Date | null = null
  for (const row of rows) {
    if (Date.now() - started > BACKFILL_BUDGET_MS) break
    results.push(await recordAttendanceForRecording(row.id, { dryRun: opts.dryRun, planned, skipSummary: true, createdIds }))
    last = row.startedAt
  }
  if (!opts.dryRun && createdIds.size > 0) await rebuildAttendanceSummaries([...createdIds]).catch((e) => console.error('[calls/attendance] summary rebuild failed:', e instanceof Error ? e.message : e))
  // More to do when the cap or the time budget stopped the run before the window's end.
  const more = last !== null && (results.length < rows.length || rows.length === BACKFILL_MAX_RECORDINGS)
  return { dryRun: opts.dryRun, days, recordings: results.length, created: results.reduce((n, r) => n + r.created, 0), nextBefore: more ? last!.toISOString() : null, results }
}
