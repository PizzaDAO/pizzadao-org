import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/app/lib/cron-auth'
import { internalError } from '@/app/lib/errors/error-response'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { completeDuePairs, retryDeferredIntros } from '@/app/lib/buddy/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * GET /api/cron/buddies: daily (plus an hourly ?mode=intros pass) (Vercel Cron, `Authorization: Bearer $CRON_SECRET`). Completes buddy
 * pairs whose trainee has reached the configured level. Does nothing while buddy.enabled is off.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    // ?mode=intros (hourly): only the cheap deferred-intro retry, so the second access check lands close to
    // the configured wait. The daily run does everything.
    const introsOnly = new URL(request.url).searchParams.get('mode') === 'intros'
    if (introsOnly && !(await toggleEnabled('buddy.enabled'))) return NextResponse.json({ opened: 0, waiting: 0, cancelled: 0 })
    const result = introsOnly ? await retryDeferredIntros() : await completeDuePairs()
    console.log('[cron/buddies]', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err) {
    return internalError(err, 'cron/buddies', 'Buddy run failed')
  }
}
