import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/app/lib/cron-auth'
import { internalError } from '@/app/lib/errors/error-response'
import { runMafiaRankPrecompute } from '@/app/lib/mafia-points/precompute'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Stop starting new members after this long, leaving headroom under maxDuration. */
const RANK_BUDGET_MS = 250_000

/**
 * GET /api/cron/mafia-ranks — nightly precompute of every member's Pizza Mafia rank into
 * MafiaRankCache (Vercel Cron, `Authorization: Bearer $CRON_SECRET`; no secret, no run).
 * Oldest-computed members go first, so a run cut off by the time budget resumes next night.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await runMafiaRankPrecompute({ budgetMs: RANK_BUDGET_MS })
    console.log('[cron/mafia-ranks]', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err) {
    return internalError(err, 'cron/mafia-ranks', 'Mafia rank precompute failed')
  }
}
