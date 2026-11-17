import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/app/lib/cron-auth'
import { internalError } from '@/app/lib/errors/error-response'
import { runRsvEventsRefresh } from '@/app/lib/events-attended/cron'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** GET /api/cron/rsv-events: nightly (Vercel Cron, Bearer CRON_SECRET). Re-checks stale rsv.pizza matches in a time-boxed batch. */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await runRsvEventsRefresh()
    console.log('[cron/rsv-events]', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err) {
    return internalError(err, 'cron/rsv-events', 'rsv.pizza events refresh failed')
  }
}
