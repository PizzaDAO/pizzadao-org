import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/app/lib/cron-auth'
import { internalError } from '@/app/lib/errors/error-response'
import { sweepAwaitingWallet } from '@/app/lib/slices/claims'
import { processMintQueue } from '@/app/lib/slices/mint-queue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/cron/slices-mint — every 5 minutes (Vercel Cron, Bearer CRON_SECRET).
 * Backstop for the mint queue: promotes AWAITING_WALLET claims whose member now has a
 * wallet, reconciles in-flight transactions and sends the next batch. Does nothing on-chain
 * while SLICES_ENABLED is not "true". Single-flight via the SliceMintLease row.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const promoted = await sweepAwaitingWallet()
    const result = await processMintQueue()
    console.log('[cron/slices-mint]', JSON.stringify({ promoted, ...result }))
    return NextResponse.json({ promoted, ...result })
  } catch (err) {
    return internalError(err, 'cron/slices-mint', 'Slices mint cron failed')
  }
}
