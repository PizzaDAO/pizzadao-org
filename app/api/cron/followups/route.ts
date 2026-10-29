import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/app/lib/cron-auth'
import { internalError } from '@/app/lib/errors/error-response'
import { loadFollowUpConfig } from '@/app/lib/followups/config'
import { draftFollowUpsForRecording, listNeedingFollowups } from '@/app/lib/followups/draft'
import { processDue } from '@/app/lib/followups/send'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * GET /api/cron/followups — every 10 minutes (Vercel Cron, Bearer CRON_SECRET).
 *  1. Drafts follow-ups for summarized calls that have not had their one pass yet (one call per run).
 *  2. Sends APPROVED follow-ups that are due (quiet hours, daily cap and the send switch applied;
 *     at most 20 per run). Nothing is ever sent for a row that has not been approved.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const started = Date.now()
    const cfg = await loadFollowUpConfig()
    const drafted: Array<{ id: string; result: string; created: number }> = []
    if (cfg.draftEnabled) {
      for (const rec of await listNeedingFollowups(1)) {
        const r = await draftFollowUpsForRecording(rec.id, { budgetMs: 150_000 })
        drafted.push({ id: rec.id, result: r.result, created: r.created })
      }
    }
    // Only with time to spare: sending is quick but sequential.
    const sent = Date.now() - started < 200_000 ? await processDue() : { skipped: 1 }
    console.log('[cron/followups]', JSON.stringify({ drafted, sent }))
    return NextResponse.json({ drafted, sent })
  } catch (err) {
    return internalError(err, 'cron/followups', 'Follow-ups cron failed')
  }
}
