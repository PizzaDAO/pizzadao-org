import { NextRequest, NextResponse } from 'next/server'
import { getUserProgressSummary } from '@/app/lib/missions'
import { getCachedProgress, setCachedProgress } from '@/app/lib/mission-cache'
import { internalError } from '@/app/lib/errors/error-response'

export const runtime = 'nodejs'

const CACHE_HEADERS = { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800' }

// GET - Get a user's mission progress (public, for profiles)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ discordId: string }> }
) {
  try {
    const { discordId } = await params

    if (!discordId) {
      return NextResponse.json({ error: 'Missing discordId' }, { status: 400 })
    }

    // Check cache
    const cached = getCachedProgress(discordId)
    if (cached) {
      return NextResponse.json(cached, { headers: CACHE_HEADERS })
    }

    const summary = await getUserProgressSummary(discordId)

    // Cache the result
    setCachedProgress(discordId, summary)

    return NextResponse.json(summary, { headers: CACHE_HEADERS })
  } catch (error) {
    return internalError(error, 'missions/progress/[discordId]')
  }
}
