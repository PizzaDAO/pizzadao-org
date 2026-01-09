import { NextResponse } from 'next/server'
import { getLeaderboard, formatCurrency } from '@/app/lib/economy'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const leaderboard = await getLeaderboard(10)

    return NextResponse.json({
      leaderboard: leaderboard.map((entry, index) => ({
        rank: index + 1,
        userId: entry.userId,
        wallet: entry.wallet,
        bank: entry.bank,
        total: entry.total,
        formatted: formatCurrency(entry.total)
      }))
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
