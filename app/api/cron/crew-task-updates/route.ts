import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/app/lib/cron-auth'
import { internalError } from '@/app/lib/errors/error-response'
import { runCrewTaskUpdatePosts } from '@/app/lib/crews/task-update-posts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/crew-task-updates — every 15 minutes (Vercel Cron, Bearer CRON_SECRET).
 * Posts at most one digest per crew per crews.taskUpdateDigestMinutes about task changes made on
 * the website. Does nothing while crews.taskUpdatePostsEnabled is off, or on a preview deploy.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await runCrewTaskUpdatePosts()
    if (result.status === 'disabled') return NextResponse.json({ skipped: 'disabled' })
    console.log('[cron/crew-task-updates]', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err) {
    return internalError(err, 'cron/crew-task-updates', 'Crew task update cron failed')
  }
}
