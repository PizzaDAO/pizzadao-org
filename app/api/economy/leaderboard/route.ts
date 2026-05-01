import { NextResponse } from 'next/server'
import { getLeaderboard, formatCurrency } from '@/app/lib/economy'

export const runtime = 'nodejs'

// In-memory cache for leaderboard (5-min TTL)
let leaderboardCache: { data: any; timestamp: number } | null = null
const LEADERBOARD_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export async function GET() {
  try {
    // Check cache
    if (leaderboardCache && Date.now() - leaderboardCache.timestamp < LEADERBOARD_CACHE_TTL) {
      return NextResponse.json(leaderboardCache.data, {
        headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800' }
      })
    }

    const leaderboard = await getLeaderboard(10)

    const result = {
      leaderboard: leaderboard.map((entry: any, index: number) => ({
        rank: index + 1,
        userId: entry.userId,
        balance: entry.balance,
        formatted: formatCurrency(entry.balance)
      }))
    }

    // Cache the result
    leaderboardCache = { data: result, timestamp: Date.now() }

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800' }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
