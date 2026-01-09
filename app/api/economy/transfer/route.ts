import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { transfer, requireOnboarded, formatCurrency } from '@/app/lib/economy'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()

    if (!session?.discordId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    await requireOnboarded(session.discordId)

    const body = await request.json()
    const { toUserId, amount } = body

    if (!toUserId || typeof toUserId !== 'string') {
      return NextResponse.json({ error: 'Recipient user ID required' }, { status: 400 })
    }

    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json({ error: 'Valid positive amount required' }, { status: 400 })
    }

    const result = await transfer(session.discordId, toUserId, Math.floor(amount))

    return NextResponse.json({
      success: true,
      message: `Transferred ${formatCurrency(result.amount)} to user`,
      amount: result.amount
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
