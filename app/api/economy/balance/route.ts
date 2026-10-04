import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { getBalance, requireOnboarded, formatCurrency } from '@/app/lib/economy'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const session = await getSession()

    if (!session?.discordId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401, headers: NO_STORE_HEADERS })
    }

    await requireOnboarded(session.discordId)
    const { balance } = await getBalance(session.discordId)

    return NextResponse.json({
      balance,
      formatted: formatCurrency(balance)
    }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 400, headers: NO_STORE_HEADERS })
  }
}
