import { NextResponse } from 'next/server'
import { requireCallReviewer } from '@/app/lib/calls/access'
import { buildCompareReport, editAttendance, recentAttendanceEdits } from '@/app/lib/calls/attendance-compare'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { ValidationError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } }
const SNOWFLAKE = /^\d{17,20}$/
const CREW_ID = /^[A-Za-z0-9_-]{1,60}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * GET /api/admin/calls/attendance?days=30 -- the compare report (sheet versus recordings per crew and day) and the latest edits.
 * POST /api/admin/calls/attendance { action: "add" | "remove", discordId, crewId, date, reason?, displayName? } -- admin fix-up.
 * Dread Pizza Roberts only. Every change is kept in AttendanceEdit (who, what, when, why).
 */
export const GET = withErrorHandling(async (request: Request) => {
  const auth = await requireCallReviewer()
  if (!auth.ok) return auth.response
  const days = Number(new URL(request.url).searchParams.get('days') ?? 30)
  const [report, edits] = await Promise.all([buildCompareReport({ days: Number.isFinite(days) ? days : 30 }), recentAttendanceEdits()])
  return NextResponse.json({ report, edits }, NO_STORE)
})

export const POST = withErrorHandling(async (request: Request) => {
  const auth = await requireCallReviewer()
  if (!auth.ok) return auth.response
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') throw new ValidationError('Invalid body')
  const { action, discordId, crewId, date, reason, displayName } = body
  if (action !== 'add' && action !== 'remove') throw new ValidationError('action must be add or remove')
  if (typeof discordId !== 'string' || !SNOWFLAKE.test(discordId)) throw new ValidationError('discordId must be a Discord id')
  if (typeof crewId !== 'string' || !CREW_ID.test(crewId)) throw new ValidationError('crewId is invalid')
  if (typeof date !== 'string' || !DATE.test(date) || Number.isNaN(new Date(`${date}T00:00:00.000Z`).getTime())) throw new ValidationError('date must be YYYY-MM-DD')
  if (reason !== undefined && reason !== null && (typeof reason !== 'string' || reason.length > 200)) throw new ValidationError('reason must be text up to 200 characters')
  if (displayName !== undefined && displayName !== null && (typeof displayName !== 'string' || displayName.length > 100)) throw new ValidationError('displayName must be text up to 100 characters')
  const result = await editAttendance({
    action,
    discordId,
    crewId,
    date,
    actorId: auth.session.discordId,
    reason: (reason as string | null | undefined) ?? null,
    displayName: (displayName as string | null | undefined) ?? null,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true })
})
