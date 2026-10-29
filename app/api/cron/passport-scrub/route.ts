import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/app/lib/cron-auth'
import { internalError } from '@/app/lib/errors/error-response'
import { scrubCoordinates } from '@/app/lib/passport/scrub'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/cron/passport-scrub: daily (Vercel Cron, Bearer CRON_SECRET). Clears check-in coordinates older than 30 days. */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const scrubbed = await scrubCoordinates()
    console.log('[cron/passport-scrub]', JSON.stringify({ scrubbed }))
    return NextResponse.json({ scrubbed })
  } catch (err) {
    return internalError(err, 'cron/passport-scrub', 'Passport scrub failed')
  }
}
