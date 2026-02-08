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

    return NextResponse.json({
      inventory: inventory.map((inv: any) => ({
        itemId: inv.itemId,
        name: inv.item.name,
        description: inv.item.description,
        quantity: inv.quantity
      }))
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
