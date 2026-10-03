import { after, NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/app/lib/cron-auth'
import { syncAllCrewAttendance } from '@/app/lib/attendance'
import { internalError } from '@/app/lib/errors/error-response'
import { emitMissionEventMany } from '@/app/lib/mission-verify/events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * GET /api/cron/attendance — nightly attendance sync from the community and
 * crew call sheets into CallAttendance (Vercel Cron, `Authorization: Bearer
 * $CRON_SECRET`). Same work as the admin-triggered POST /api/attendance/sync.
 * The nightly missions run (/api/cron/missions) is scheduled after it, so the
 * call missions (L2.0, L5.0) see the new attendance.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { affectedDiscordIds = [], ...stats } = await syncAllCrewAttendance()
    // Members who gained attendance rows: re-check their call missions now (no-op while verifiers are off).
    if (affectedDiscordIds.length) after(() => emitMissionEventMany(affectedDiscordIds, 'attendance_synced'))
    console.log('[cron/attendance]', JSON.stringify({ ...stats, affectedMembers: affectedDiscordIds.length }))
    return NextResponse.json({ ...stats, affectedMembers: affectedDiscordIds.length })
  } catch (err) {
    return internalError(err, 'cron/attendance', 'Attendance sync failed')
  }
}
