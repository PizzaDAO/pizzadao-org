import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/app/lib/cron-auth'
import { internalError } from '@/app/lib/errors/error-response'
import { callAgendaEnabled, runCallAgenda } from '@/app/lib/call-agenda/run'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/call-agenda — every 10 minutes (Vercel Cron, Bearer CRON_SECRET).
 * Posts each crew's pre-call agenda ~30 minutes before its Discord scheduled
 * event. Does nothing while calls.agendaPostEnabled is off. Idempotent per event occurrence.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!(await callAgendaEnabled())) return NextResponse.json({ skipped: 'disabled' })
  try {
    const result = await runCallAgenda()
    console.log('[cron/call-agenda]', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err) {
    return internalError(err, 'cron/call-agenda', 'Call agenda cron failed')
  }
}
