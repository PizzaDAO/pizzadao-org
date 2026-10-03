import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { getMissionsOverview } from '@/app/lib/missions-overview'
import { missionVerifiersEnabled } from '@/app/lib/mission-verify/policy'

export const runtime = 'nodejs'

// GET - List all missions + user progress if authenticated. Same payload as
// the server-rendered /missions page (getMissionsOverview), plus whether
// automatic verification is switched on.
export async function GET() {
  try {
    const session = await getSession()
    const overview = await getMissionsOverview(session?.discordId)

    return NextResponse.json({ ...overview, verifiersEnabled: missionVerifiersEnabled() }, {
      headers: {
        'Cache-Control': session?.discordId
          ? 'private, no-store'
          : 'public, s-maxage=3600, stale-while-revalidate=86400',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
