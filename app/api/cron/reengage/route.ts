import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/app/lib/cron-auth'
import { internalError } from '@/app/lib/errors/error-response'
import { loadSettings } from '@/app/lib/settings'
import { isReengageSendDay, reengageSendWeekday } from '@/app/lib/reengage/send-day'
import { runReengage } from '@/app/lib/reengage/run'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * GET /api/cron/reengage — the weekly re-engagement email (Vercel Cron,
 * `Authorization: Bearer $CRON_SECRET`). See app/lib/reengage/run.ts.
 * Sends nothing while reengage.enabled is not "true"; `?dry=1` forces a
 * dry run even when enabled (counts only, no sends, no rows written);
 * `?limit=N` overrides the batch size (capped).
 * The cron fires daily (16:00-21:00 UTC); a real send only happens on the day set in
 * reengage.sendWeekday (default Tuesday). On other days the run is skipped, and `?dry=1` still works.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const url = new URL(request.url)
    const dry = url.searchParams.get('dry') === '1'
    const settings = await loadSettings()
    if (!dry && !isReengageSendDay(new Date(), settings)) {
      return NextResponse.json({ skipped: 'not-send-day', weekday: reengageSendWeekday(settings) })
    }
    const limit = Number(url.searchParams.get('limit'))
    const result = await runReengage({
      dryRun: dry,
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    })
    console.log('[cron/reengage]', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err) {
    return internalError(err, 'cron/reengage', 'Re-engagement email run failed')
  }
}
