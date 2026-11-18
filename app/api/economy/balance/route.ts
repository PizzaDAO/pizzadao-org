import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { getBalance, requireOnboarded, formatCurrency } from '@/app/lib/economy'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'
import { internalError } from '@/app/lib/errors/error-response'

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
    return internalError(error, 'economy/balance', 'Internal server error', 400, NO_STORE_HEADERS)
  }
}
