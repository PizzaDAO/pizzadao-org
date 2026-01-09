import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { deposit, requireOnboarded, formatCurrency, getBalance } from '@/app/lib/economy'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()

    if (!session?.discordId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    await requireOnboarded(session.discordId)

    const body = await request.json()
    const { amount } = body

    if (!amount || typeof amount !== 'number' || amount <= 0) {
      return NextResponse.json({ error: 'Valid positive amount required' }, { status: 400 })
    }

    await deposit(session.discordId, Math.floor(amount))
    const balance = await getBalance(session.discordId)

    return NextResponse.json({
      success: true,
      message: `Deposited ${formatCurrency(amount)} to bank`,
      wallet: balance.wallet,
      bank: balance.bank
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
