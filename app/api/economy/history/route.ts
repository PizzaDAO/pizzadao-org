import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { getTransactionHistory } from '@/app/lib/transactions'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()

    if (!session?.discordId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { searchParams } = request.nextUrl
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10), 1), 100)
    const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10), 0)

    const { transactions, total } = await getTransactionHistory(session.discordId, limit, offset)

    return NextResponse.json({ transactions, total })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
