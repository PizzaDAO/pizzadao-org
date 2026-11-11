import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/app/lib/cron-auth'
import { internalError } from '@/app/lib/errors/error-response'
import { runCallRemindersNow } from '@/app/lib/reminders/run'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * GET /api/cron/reminders — every 5 minutes (Vercel Cron, Bearer CRON_SECRET).
 * Call reminders by Discord DM to members who opted in. Off (reminders.callsEnabled, or any preview):
 * nothing is sent or claimed and only counts are logged ("dry run"). Counts only, never ids or names.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await runCallRemindersNow()
    console.log('[cron/reminders]', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err) {
    return internalError(err, 'cron/reminders', 'Reminders cron failed')
  }
}
