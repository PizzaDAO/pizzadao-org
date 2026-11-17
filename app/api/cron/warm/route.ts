import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/app/lib/cron-auth'
import { internalError } from '@/app/lib/errors/error-response'
import { getSetting } from '@/app/lib/settings'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { SITE_URL } from '@/app/lib/site-url'
import { runWarm, warmTargets } from '@/app/lib/warm'
import { getPublicChannelNames } from '@/app/lib/discord-activity-public'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/warm: every 5 minutes (Vercel Cron, `Authorization: Bearer $CRON_SECRET`). Requests the
 * configured pages and member profiles (settings members.warmPaths / members.warmProfileIds) over the
 * public URL so function instances, the shared caches and the database stay warm, and refreshes the
 * shared Discord channel-name cache when it is stale. Reads only; writes nothing. Switch:
 * members.warmEnabled.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    if (!(await toggleEnabled('members.warmEnabled'))) return NextResponse.json({ status: 'disabled' })
    const [ids, paths] = await Promise.all([getSetting('members.warmProfileIds'), getSetting('members.warmPaths')])
    const targets = warmTargets(ids, paths)
    // Serves the stored channel names and, when they are stale, refreshes them in the background.
    void getPublicChannelNames().catch(() => null)
    const results = await runWarm(SITE_URL, targets)
    const failed = results.filter((r) => r.status === null || r.status >= 500).length
    console.log('[cron/warm]', JSON.stringify({ requested: results.length, failed, slowest: Math.max(0, ...results.map((r) => r.ms)) }))
    return NextResponse.json({ status: 'ok', requested: results.length, failed, results })
  } catch (err) {
    return internalError(err, 'cron/warm', 'Prewarm failed')
  }
}
