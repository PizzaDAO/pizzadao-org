import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/app/lib/cron-auth'
import { internalError } from '@/app/lib/errors/error-response'
import { runCollectionStatsPrecompute } from '@/app/lib/collection-stats/precompute'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Stop starting new members after this long, leaving headroom under maxDuration. */
const BUDGET_MS = 250_000

/**
 * GET /api/cron/collection-stats — nightly precompute of every member's POAP / NFT / ticket counts
 * into MemberCollectionStats (Vercel Cron, `Authorization: Bearer $CRON_SECRET`).
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await runCollectionStatsPrecompute({ budgetMs: BUDGET_MS })
    console.log('[cron/collection-stats]', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err) {
    return internalError(err, 'cron/collection-stats', 'Collection stats precompute failed')
  }
}
