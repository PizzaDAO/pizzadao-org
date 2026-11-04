import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/app/lib/cron-auth'
import { internalError } from '@/app/lib/errors/error-response'
import { dstFixConfig, runEventTimeSync } from '@/app/lib/calls/event-time-sync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/event-time-sync — every 6 hours (Vercel Cron, Bearer CRON_SECRET).
 * Moves recurring crew-call Discord events back to their intended local time after a daylight
 * saving change (plans/dst-crew-call-times.md). Does nothing while calls.dstFixEnabled is off; with
 * calls.dstFixDryRun on (the default) it only logs. Running events are retried on a later run.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const cfg = await dstFixConfig()
    if (!cfg.enabled) return NextResponse.json({ skipped: 'disabled' })
    const result = await runEventTimeSync({ dryRun: cfg.dryRun, post: true })
    console.log('[cron/event-time-sync]', JSON.stringify('notRun' in result ? result : { ...result, logged: result.logged.length }))
    return NextResponse.json('notRun' in result ? result : { ...result, logged: result.logged.length })
  } catch (err) {
    return internalError(err, 'cron/event-time-sync', 'Event time sync cron failed')
  }
}
