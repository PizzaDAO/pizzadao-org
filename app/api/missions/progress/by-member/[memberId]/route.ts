import { NextRequest, NextResponse } from 'next/server'
import { fetchMemberById } from '@/app/lib/sheets/member-repository'
import { getUserProgressSummary } from '@/app/lib/missions'
import { getCachedProgress, setCachedProgress, registerProgressAlias } from '@/app/lib/mission-cache'

export const runtime = 'nodejs'

const CACHE_HEADERS = { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800' }

// GET - Get a user's mission progress by member ID (for profiles)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
) {
  try {
    const { memberId } = await params

    if (!memberId) {
      return NextResponse.json({ error: 'Missing memberId' }, { status: 400 })
    }

    // Check cache by memberId
    const cached = getCachedProgress(memberId)
    if (cached) {
      return NextResponse.json(cached, { headers: CACHE_HEADERS })
    }

    // Resolve memberId to discordId via the crew sheet
    const member = await fetchMemberById(memberId)
    if (!member?.discordId) {
      // No discordId found - return empty progress (don't cache empty results)
      return NextResponse.json({
        currentLevel: 1,
        levelTitle: null,
        totalMissions: 0,
        approvedCount: 0,
        currentLevelMissions: 0,
        currentLevelApproved: 0,
      })
    }

    // Check cache by discordId (may have been cached from the other route)
    const cachedByDiscord = getCachedProgress(member.discordId)
    if (cachedByDiscord) {
      // Also cache under memberId for future lookups
      setCachedProgress(memberId, cachedByDiscord)
      registerProgressAlias(member.discordId, memberId)
      return NextResponse.json(cachedByDiscord, { headers: CACHE_HEADERS })
    }

    const summary = await getUserProgressSummary(member.discordId)

    // Cache under both memberId and discordId
    setCachedProgress(memberId, summary)
    setCachedProgress(member.discordId, summary)
    registerProgressAlias(member.discordId, memberId)

    return NextResponse.json(summary, { headers: CACHE_HEADERS })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
