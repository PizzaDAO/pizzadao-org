import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/app/lib/cron-auth'
import { internalError } from '@/app/lib/errors/error-response'
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
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const url = new URL(request.url)
    const limit = Number(url.searchParams.get('limit'))
    const result = await runReengage({
      dryRun: url.searchParams.get('dry') === '1',
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    })
    console.log('[cron/reengage]', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err) {
    return internalError(err, 'cron/reengage', 'Re-engagement email run failed')
  }
}
