/**
 * Admin compare report: who the daily sheets counted versus who the recordings counted, per crew and day
 * (the acceptance check before the sheets are switched off), and the add/remove edits behind the admin screen.
 *
 * Recording attendance is recomputed from the recordings (CallPresence and the thresholds), not read back from
 * CallAttendance: a person the sheet already counted never gets a recording row, so rows alone could not show "both".
 */
import { prisma } from '@/app/lib/db'
import { rebuildAttendanceSummaries } from '@/app/lib/attendance'
import { attendanceCrewId, crewIdsFor, loadCrewAliases } from './crew-alias'
import { loadAttendanceExcludes } from './attendance-exclude'
import { callDay, countedAttendees, loadAttendanceThresholds, type AttendanceThresholds, type CountedRecording } from './attendance-from-recordings'

export interface ComparePerson {
  discordId: string
  name: string | null
  /** Minutes in the channel from the recordings; null when not measured. */
  minutes: number | null
}

export interface CompareDay {
  crewId: string
  crewLabel: string
  /** Eastern calendar day, YYYY-MM-DD. */
  date: string
  recordings: number
  both: ComparePerson[]
  recordingOnly: ComparePerson[]
  sheetOnly: ComparePerson[]
  /** Added by an admin (not in the sheet). */
  manual: ComparePerson[]
}

const byName = (a: ComparePerson, b: ComparePerson) => (a.name ?? a.discordId).localeCompare(b.name ?? b.discordId)

/** Pure: split one crew-day into both / recording-only / sheet-only / manual. `removed` (admin removals) leave the recording side. */
export function compareDay(input: {
  recording: Map<string, { name: string | null; presentSec: number | null }>
  sheet: Array<{ discordId: string; displayName: string | null }>
  manual: Array<{ discordId: string; displayName: string | null }>
  removed?: ReadonlySet<string>
}): Pick<CompareDay, 'both' | 'recordingOnly' | 'sheetOnly' | 'manual'> {
  const sheet = new Map(input.sheet.map((r) => [r.discordId, r.displayName]))
  const manualIds = new Set(input.manual.map((r) => r.discordId))
  const mins = (s: number | null | undefined) => (s == null ? null : Math.max(0, Math.round(s / 60)))
  const both: ComparePerson[] = []
  const recordingOnly: ComparePerson[] = []
  for (const [discordId, r] of input.recording) {
    if (input.removed?.has(discordId)) continue
    if (manualIds.has(discordId)) continue
    const p = { discordId, name: r.name ?? sheet.get(discordId) ?? null, minutes: mins(r.presentSec) }
    if (sheet.has(discordId)) both.push(p)
    else recordingOnly.push(p)
  }
  const sheetOnly = input.sheet
    .filter((r) => !input.recording.has(r.discordId) || input.removed?.has(r.discordId))
    .map((r) => ({ discordId: r.discordId, name: r.displayName, minutes: null }))
  const manual = input.manual.map((r) => ({ discordId: r.discordId, name: r.displayName, minutes: null }))
  return { both: both.sort(byName), recordingOnly: recordingOnly.sort(byName), sheetOnly: sheetOnly.sort(byName), manual: manual.sort(byName) }
}

export const COMPARE_MAX_DAYS = 120

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function humanize(id: string): string {
  return id.split(/[_-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ')
}

/** Crew-days of the last `days` days, newest first, with recordings or attendance rows. */
export async function buildCompareReport(opts: { days: number; thresholds?: AttendanceThresholds; now?: Date }): Promise<CompareDay[]> {
  const days = Math.min(Math.max(Math.trunc(opts.days) || 30, 1), COMPARE_MAX_DAYS)
  const since = new Date((opts.now ?? new Date()).getTime() - days * 86_400_000)
  const sinceDay = callDay(since)
  const [aliases, thresholds, exclude] = await Promise.all([loadCrewAliases(), opts.thresholds ?? loadAttendanceThresholds(), loadAttendanceExcludes()])

  const recs = await prisma.callRecording.findMany({
    where: { crewId: { not: null }, status: { not: 'REJECTED' }, startedAt: { gte: sinceDay } },
    select: {
      crewId: true,
      crewLabel: true,
      startedAt: true,
      durationSec: true,
      source: true,
      participantIds: true,
      speakers: { select: { discordId: true, displayName: true, talkTimeSec: true } },
      presence: { select: { discordId: true, presentSec: true } },
    },
  })
  const rows = await prisma.callAttendance.findMany({
    where: { callDate: { gte: sinceDay } },
    select: { discordId: true, displayName: true, crewId: true, crewLabel: true, callDate: true, source: true },
  })
  const edits = await prisma.attendanceEdit.findMany({ where: { callDate: { gte: sinceDay } }, select: { discordId: true, action: true, crewId: true, callDate: true }, orderBy: { id: 'asc' } })

  const keyOf = (crewId: string, day: Date) => `${attendanceCrewId(crewId, aliases)}|${ymd(day)}`
  interface Bucket { crewId: string; crewLabel: string; date: string; recs: CountedRecording[]; sheet: Map<string, string | null>; manual: Map<string, string | null>; latest: Map<string, string> }
  const buckets = new Map<string, Bucket>()
  const bucket = (crewId: string, label: string | null, day: Date): Bucket => {
    const canonical = attendanceCrewId(crewId, aliases)
    const k = keyOf(crewId, day)
    let b = buckets.get(k)
    if (!b) {
      b = { crewId: canonical, crewLabel: canonical === crewId && label ? label : humanize(canonical), date: ymd(day), recs: [], sheet: new Map(), manual: new Map(), latest: new Map() }
      buckets.set(k, b)
    }
    return b
  }
  for (const r of recs) bucket(r.crewId!, r.crewLabel, callDay(r.startedAt)).recs.push(r)
  for (const r of rows) {
    const b = bucket(r.crewId, r.crewLabel, r.callDate)
    if (r.source === 'sheet') b.sheet.set(r.discordId, r.displayName)
    else if (r.source === 'manual') b.manual.set(r.discordId, r.displayName)
  }
  for (const e of edits) bucket(e.crewId, null, e.callDate).latest.set(e.discordId, e.action)

  const out: CompareDay[] = []
  for (const b of buckets.values()) {
    const removed = new Set([...b.latest].filter(([, action]) => action === 'remove').map(([id]) => id))
    const split = compareDay({
      recording: countedAttendees(b.recs, thresholds, exclude),
      sheet: [...b.sheet].filter(([id]) => !exclude.has(id)).map(([discordId, displayName]) => ({ discordId, displayName })),
      manual: [...b.manual].filter(([id]) => !exclude.has(id)).map(([discordId, displayName]) => ({ discordId, displayName })),
      removed,
    })
    out.push({ crewId: b.crewId, crewLabel: b.crewLabel, date: b.date, recordings: b.recs.length, ...split })
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.crewLabel.localeCompare(b.crewLabel))
}

export interface AttendanceEditInput {
  action: 'add' | 'remove'
  discordId: string
  crewId: string
  /** YYYY-MM-DD */
  date: string
  actorId: string
  reason?: string | null
  displayName?: string | null
}

export type AttendanceEditResult = { ok: true; changed: boolean } | { ok: false; status: number; error: string }

/**
 * Admin add or remove of one attendee for a crew and day. Removal only deletes `manual` and `recording` rows (sheet rows
 * come from the sheets and would be re-synced). Every change is written to AttendanceEdit; a removal also keeps the
 * recording attendance from adding the person back. Summaries are rebuilt for the person.
 */
export async function editAttendance(input: AttendanceEditInput): Promise<AttendanceEditResult> {
  const aliases = await loadCrewAliases()
  const crewId = attendanceCrewId(input.crewId, aliases)
  const crewIds = crewIdsFor(crewId, aliases)
  const day = new Date(`${input.date}T00:00:00.000Z`)
  const reason = input.reason?.trim().slice(0, 200) || null
  const where = { crewId: { in: crewIds }, callDate: day, discordId: input.discordId }

  if (input.action === 'add') {
    const existing = await prisma.callAttendance.findFirst({ where, select: { id: true } })
    if (existing) return { ok: false, status: 409, error: 'Already counted for that crew and day' }
    const [labelRow, nameRow] = await Promise.all([
      prisma.callAttendance.findFirst({ where: { crewId }, select: { crewLabel: true }, orderBy: { callDate: 'desc' } }),
      input.displayName ? Promise.resolve(null) : prisma.callAttendance.findFirst({ where: { discordId: input.discordId, displayName: { not: null } }, select: { displayName: true }, orderBy: { callDate: 'desc' } }),
    ])
    const crewLabel = labelRow?.crewLabel ?? humanize(crewId)
    await prisma.$transaction([
      prisma.callAttendance.create({
        data: {
          discordId: input.discordId,
          displayName: input.displayName?.trim().slice(0, 100) || nameRow?.displayName || null,
          crewId,
          crewLabel,
          callDate: day,
          dailySheetId: `manual:${crewId}:${input.date}`,
          source: 'manual',
        },
      }),
      prisma.attendanceEdit.create({ data: { action: 'add', discordId: input.discordId, crewId, callDate: day, actorId: input.actorId, reason } }),
    ])
  } else {
    const rows = await prisma.callAttendance.findMany({ where, select: { id: true, source: true } })
    if (rows.length === 0) return { ok: false, status: 404, error: 'Not counted for that crew and day' }
    if (rows.some((r) => r.source !== 'manual' && r.source !== 'recording')) return { ok: false, status: 400, error: 'Sheet rows cannot be removed here' }
    await prisma.$transaction([
      prisma.callAttendance.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } }),
      prisma.attendanceEdit.create({ data: { action: 'remove', discordId: input.discordId, crewId, callDate: day, actorId: input.actorId, reason, source: rows[0].source } }),
    ])
  }
  await rebuildAttendanceSummaries([input.discordId]).catch((e) => console.error('[calls/attendance] summary rebuild failed:', e instanceof Error ? e.message : e))
  return { ok: true, changed: true }
}

/** Recent edits for the audit list, newest first. */
export async function recentAttendanceEdits(take = 50) {
  return prisma.attendanceEdit.findMany({ orderBy: { id: 'desc' }, take: Math.min(Math.max(take, 1), 200) })
}
