import { NextResponse } from 'next/server'
import { getShopItems } from '@/app/lib/shop'
import { formatCurrency } from '@/app/lib/economy'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const items = await getShopItems()

    return NextResponse.json({
      items: items.map(item => ({
        id: item.id,
        name: item.name,
        description: item.description,
        price: item.price,
        priceFormatted: formatCurrency(item.price),
        quantity: item.quantity,
        inStock: item.quantity === -1 || item.quantity > 0
      }))
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
