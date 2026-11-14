import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/app/lib/cron-auth'
import { internalError } from '@/app/lib/errors/error-response'
import { completeDuePairs } from '@/app/lib/buddy/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * GET /api/cron/buddies: daily (Vercel Cron, `Authorization: Bearer $CRON_SECRET`). Completes buddy
 * pairs whose trainee has reached the configured level. Does nothing while buddy.enabled is off.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await completeDuePairs()
    console.log('[cron/buddies]', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err) {
    return internalError(err, 'cron/buddies', 'Buddy run failed')
  }
}
