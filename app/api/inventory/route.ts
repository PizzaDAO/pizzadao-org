import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { getInventory } from '@/app/lib/shop'
import { requireOnboarded } from '@/app/lib/economy'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const session = await getSession()

    if (!session?.discordId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    await requireOnboarded(session.discordId)

    const inventory = await getInventory(session.discordId)

    // Every held item is listed, including collectibles and items no longer
    // for sale. Flat fields for the shop InventoryList, plus `item` for the
    // /pep inventory card (which reads inv.item.*).
    return NextResponse.json({
      inventory: inventory.map((inv: any) => ({
        itemId: inv.itemId,
        name: inv.item.name,
        description: inv.item.description,
        image: inv.item.image ?? null,
        isCollectible: !!inv.item.isCollectible,
        quantity: inv.quantity,
        item: {
          id: inv.item.id,
          name: inv.item.name,
          description: inv.item.description,
          image: inv.item.image ?? null,
          isCollectible: !!inv.item.isCollectible
        }
      }))
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
