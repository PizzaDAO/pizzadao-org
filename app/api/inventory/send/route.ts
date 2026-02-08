import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { prisma } from '@/app/lib/db'
import { getOrCreateEconomy } from '@/app/lib/economy'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()

    if (!session?.discordId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const body = await request.json()
    const { toUserId, itemId, quantity } = body

    if (!toUserId || typeof toUserId !== 'string') {
      return NextResponse.json({ error: 'Recipient ID required' }, { status: 400 })
    }

    if (!itemId || typeof itemId !== 'number') {
      return NextResponse.json({ error: 'Item ID required' }, { status: 400 })
    }

    if (!quantity || typeof quantity !== 'number' || quantity <= 0) {
      return NextResponse.json({ error: 'Valid quantity required' }, { status: 400 })
    }

    if (toUserId === session.discordId) {
      return NextResponse.json({ error: 'Cannot send to yourself' }, { status: 400 })
    }

    // Check sender has the item
    const senderInventory = await prisma.inventory.findUnique({
      where: {
        userId_itemId: { userId: session.discordId, itemId }
      },
      include: { item: true }
    })

    if (!senderInventory || senderInventory.quantity < quantity) {
      return NextResponse.json({ error: 'Insufficient items in inventory' }, { status: 400 })
    }

    // Ensure recipient exists (creates User and Economy if needed)
    await getOrCreateEconomy(toUserId)

    // Transfer the item
    await prisma.$transaction(async (tx: any) => {
      // Decrement or remove from sender
      if (senderInventory.quantity === quantity) {
        await tx.inventory.delete({
          where: {
            userId_itemId: { userId: session.discordId, itemId }
          }
        })
      } else {
        await tx.inventory.update({
          where: {
            userId_itemId: { userId: session.discordId, itemId }
          },
          data: { quantity: { decrement: quantity } }
        })
      }

      // Add to recipient (upsert)
      await tx.inventory.upsert({
        where: {
          userId_itemId: { userId: toUserId, itemId }
        },
        create: {
          userId: toUserId,
          itemId,
          quantity
        },
        update: {
          quantity: { increment: quantity }
        }
      })
    })

    return NextResponse.json({
      success: true,
      message: `Sent ${quantity}x ${senderInventory.item.name} to ${toUserId}`
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
