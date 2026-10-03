import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/app/lib/cron-auth'
import { internalError } from '@/app/lib/errors/error-response'
import { runSlaDigest } from '@/app/lib/mission-verify/sla'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/cron/mission-sla — the daily mission review SLA digest (Vercel
 * Cron, `Authorization: Bearer $CRON_SECRET`). Posts one card in #work listing
 * submissions waiting more than 48 hours and pings the reviewer roles, at most
 * once per UTC day. See app/lib/mission-verify/sla.ts. Does nothing while
 * MISSION_REVIEW_CARDS_ENABLED is off.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await runSlaDigest()
    console.log('[cron/mission-sla]', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err) {
    return internalError(err, 'cron/mission-sla', 'Mission SLA digest failed')
  }
}
