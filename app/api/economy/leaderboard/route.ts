import { NextResponse } from 'next/server'
import { getLeaderboard, formatCurrency } from '@/app/lib/economy'
import { getSheetData } from '@/app/lib/sheets/member-repository'

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

    // spinach-65462: resolve each entry's Discord ID to a memberId on the
    // server so the /pep leaderboard can link to /profile/{memberId} (the
    // small integer sheet ID) instead of /profile/{discordSnowflake}. The
    // sheet is already cached (5-min TTL) so this is a single in-memory map
    // lookup per row — no extra fetches.
    const sheetData = await getSheetData().catch(() => null)
    const discordToMember = sheetData?.discordToMember ?? null

    const result = {
      leaderboard: leaderboard.map((entry: any, index: number) => ({
        rank: index + 1,
        userId: entry.userId,
        memberId: discordToMember?.get(String(entry.userId)) ?? null,
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
