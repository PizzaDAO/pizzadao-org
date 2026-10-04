import { NextResponse } from 'next/server'
import { getShopItems } from '@/app/lib/shop'
import { formatCurrency } from '@/app/lib/economy'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const items = await getShopItems()

    return NextResponse.json({
      items: items.map((item: any) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        price: item.price,
        priceFormatted: formatCurrency(item.price),
        quantity: item.quantity,
        inStock: item.quantity === -1 || item.quantity > 0
      }))
    }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE_HEADERS })
  }
}
