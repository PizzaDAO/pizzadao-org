import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/app/lib/cron-auth'
import { internalError } from '@/app/lib/errors/error-response'
import { runRosterAutoAdd } from '@/app/lib/crews/roster-auto-add'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * GET /api/cron/crew-roster — nightly (Vercel Cron, Bearer CRON_SECRET). Adds members who regularly
 * attend a crew's calls to that crew's roster (settings crews.rosterAutoAdd*). Off by default: then it
 * only counts. `?dryRun=1` (still needs the bearer token) returns the planned adds as ids per crew
 * and writes nothing. Logs carry counts only.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await runRosterAutoAdd({ dryRun: request.nextUrl.searchParams.get('dryRun') === '1' })
    const { adds: _ids, ...counts } = result
    console.log('[cron/crew-roster]', JSON.stringify(counts))
    return NextResponse.json(result)
  } catch (err) {
    return internalError(err, 'cron/crew-roster', 'Crew roster job failed')
  }
}
