import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/app/lib/cron-auth'
import { internalError } from '@/app/lib/errors/error-response'
import { scanAllMembers } from '@/app/lib/unlock/scan'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** GET /api/cron/unlock-tickets: nightly (Vercel Cron, Bearer CRON_SECRET). Rescans every member's wallets for Pizza Party Tickets. */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await scanAllMembers()
    console.log('[cron/unlock-tickets]', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err) {
    return internalError(err, 'cron/unlock-tickets', 'Unlock ticket scan failed')
  }
}
