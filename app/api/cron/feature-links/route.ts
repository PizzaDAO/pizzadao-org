import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/app/lib/cron-auth'
import { internalError } from '@/app/lib/errors/error-response'
import { prisma } from '@/app/lib/db'
import { loadSwitches } from '@/app/lib/features/service'
import { sharedGithubClient } from '@/app/lib/features/github'
import { runLinkChecks } from '@/app/lib/features/link-check'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * GET /api/cron/feature-links: nightly check that every public code path in the features catalog still exists
 * (Vercel Cron, `Authorization: Bearer $CRON_SECRET`). Records the result on each row; edits nothing else.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { githubCacheMinutes } = await loadSwitches()
    const result = await runLinkChecks(prisma, sharedGithubClient(githubCacheMinutes), { budgetMs: 240_000 })
    console.log('[cron/feature-links]', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err) {
    return internalError(err, 'cron/feature-links', 'Feature link check failed')
  }
}
