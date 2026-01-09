import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { buyItem } from '@/app/lib/shop'
import { requireOnboarded, formatCurrency } from '@/app/lib/economy'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()

    if (!session?.discordId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    await requireOnboarded(session.discordId)

    const body = await request.json()
    const { itemId, quantity = 1 } = body

    if (!itemId || typeof itemId !== 'number') {
      return NextResponse.json({ error: 'Valid item ID required' }, { status: 400 })
    }

    if (typeof quantity !== 'number' || quantity <= 0) {
      return NextResponse.json({ error: 'Valid positive quantity required' }, { status: 400 })
    }

    const result = await buyItem(session.discordId, itemId, Math.floor(quantity))

    return NextResponse.json({
      success: true,
      message: `Purchased ${result.quantity}x ${result.item} for ${formatCurrency(result.totalCost)}`,
      item: result.item,
      quantity: result.quantity,
      totalCost: result.totalCost
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
