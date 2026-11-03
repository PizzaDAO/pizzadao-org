import { NextResponse } from 'next/server'
import { requireCallReviewer } from '@/app/lib/calls/access'
import { attendanceFromRecordingsEnabled, backfillAttendance } from '@/app/lib/calls/attendance-from-recordings'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { ValidationError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/admin/calls/attendance-backfill  { "days": 30, "dryRun": true }
 * Dread Pizza Roberts only. Counts attendance for recent recorded calls that have a crew. `dryRun` defaults to
 * true (reports what would be added, writes nothing); a real run needs "dryRun": false, "confirm": true and the
 * setting calls.attendanceFromRecordings on. Only adds rows; safe to repeat.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const auth = await requireCallReviewer()
  if (!auth.ok) return auth.response

  const body = (await request.json().catch(() => null)) as { days?: unknown; dryRun?: unknown; confirm?: unknown } | null
  const days = body?.days === undefined ? 30 : body.days
  if (typeof days !== 'number' || !Number.isFinite(days) || days < 1) throw new ValidationError('days must be a positive number')
  const dryRun = body?.dryRun !== false
  if (!dryRun) {
    if (body?.confirm !== true) throw new ValidationError('Confirmation required')
    if (!(await attendanceFromRecordingsEnabled())) throw new ValidationError('Turn on the setting "Attendance from recorded calls" first')
  }
  const result = await backfillAttendance({ days, dryRun })
  return NextResponse.json({ success: true, ...result })
})
