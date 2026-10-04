import { NextResponse } from 'next/server'
import { getLeaderboard, formatCurrency } from '@/app/lib/economy'
import { getSheetData } from '@/app/lib/sheets/member-repository'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'

export const runtime = 'nodejs'

// Balances change with every job, bounty, purchase and transfer, so the
// leaderboard is computed per request and never stored by the CDN or browser
// (it used to be memoized for 5 minutes and CDN-cached for up to 35).

export async function GET() {
  try {
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

    return NextResponse.json(result, {
      headers: NO_STORE_HEADERS
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE_HEADERS })
  }
}
