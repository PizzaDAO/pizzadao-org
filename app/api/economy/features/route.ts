import { NextResponse } from 'next/server'
import { gamesEnabled } from '@/app/lib/pep-games/config'
import { toggleEnabled } from '@/app/lib/settings/toggles'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/economy/features: which flag-gated $PEP features are live, so the
 * /pep page only shows the crime and games cards when their API is on.
 */
export async function GET() {
  return NextResponse.json({
    crime: await toggleEnabled('crime.enabled'),
    games: await gamesEnabled(),
  })
}
