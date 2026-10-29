import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/app/lib/cron-auth'
import { internalError } from '@/app/lib/errors/error-response'
import { disavowEnabled } from '@/app/lib/disavow/constants'
import { runDisavowCron } from '@/app/lib/disavow/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/cron/disavow — daily (Vercel Cron, Bearer CRON_SECRET). Settles
 * rounds that are decided or past closesAt and opens REAFFIRM rounds for
 * listings past their review date. Does nothing while the disavow feature is off.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!(await disavowEnabled())) return NextResponse.json({ skipped: 'disabled' })
  try {
    const result = await runDisavowCron()
    console.log('[cron/disavow]', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err) {
    return internalError(err, 'cron/disavow', 'Disavow cron failed')
  }
}
