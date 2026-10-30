import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/app/lib/cron-auth'
import { internalError } from '@/app/lib/errors/error-response'
import { processOutbox } from '@/app/lib/telegram/city-posts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * GET /api/cron/telegram-posts — every 5 minutes (Vercel Cron, Bearer CRON_SECRET).
 * Sends the queued city Telegram group mirrors (recaps, agendas, announcements) through the
 * rsv.pizza proxy. A no-op unless this is a production deploy with the key set and the master
 * switch on; rows stay queued while it is off. Time budget 200 s.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await processOutbox({ budgetMs: 200_000 })
    console.log('[cron/telegram-posts]', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err) {
    return internalError(err, 'cron/telegram-posts', 'Telegram posts cron failed')
  }
}
