import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { getBalance, requireOnboarded, formatCurrency } from '@/app/lib/economy'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const session = await getSession()

    if (!session?.discordId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    await requireOnboarded(session.discordId)
    const { balance } = await getBalance(session.discordId)

    return NextResponse.json({
      balance,
      formatted: formatCurrency(balance)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
