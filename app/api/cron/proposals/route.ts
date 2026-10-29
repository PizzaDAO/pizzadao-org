import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/app/lib/cron-auth'
import { internalError } from '@/app/lib/errors/error-response'
import { proposalsEnabled } from '@/app/lib/proposals/constants'
import { runProposalsCron } from '@/app/lib/proposals/lifecycle'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// A retried open takes the eligibility snapshot (one chain lookup per member with a wallet).
export const maxDuration = 300

/**
 * GET /api/cron/proposals — daily (Vercel Cron, Bearer CRON_SECRET). Counts and settles proposals past their
 * close time, posts results to Discord, opens drafts that never opened and retries missed posts.
 * Does nothing while proposals are off.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!(await proposalsEnabled())) return NextResponse.json({ skipped: 'disabled' })
  try {
    const result = await runProposalsCron()
    console.log('[cron/proposals]', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err) {
    return internalError(err, 'cron/proposals', 'Proposals cron failed')
  }
}
