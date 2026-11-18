import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { getMissionsOverview } from '@/app/lib/missions-overview'
import { loadHoldPolicy, missionVerifiersEnabled } from '@/app/lib/mission-verify/policy'
import { internalError } from '@/app/lib/errors/error-response'

export const runtime = 'nodejs'

// GET - List all missions + user progress if authenticated. Same payload as
// the server-rendered /missions page (getMissionsOverview), plus whether
// automatic verification is switched on.
export async function GET() {
  try {
    const session = await getSession()
    const overview = await getMissionsOverview(session?.discordId)

    const { humanReleaseMinLevel } = await loadHoldPolicy()
    return NextResponse.json({ ...overview, verifiersEnabled: await missionVerifiersEnabled(), humanReleaseMinLevel }, {
      // Never shared-cached: the CDN key ignores the session, so a signed-out copy would be served
      // to signed-in members without their progress.
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    return internalError(error, 'missions')
  }
}
