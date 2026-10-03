import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/app/lib/auth-guards'
import { prisma } from '@/app/lib/db'
import { getOrCreateEconomy } from '@/app/lib/economy'
import { resolvePepRecipient } from '@/app/lib/pep-recipient'
import { ValidationError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSession()
    if (!auth.ok) return auth.response
    const { session } = auth

    const body = await request.json()
    const { toUserId, itemId, quantity } = body

    if (!toUserId || typeof toUserId !== 'string') {
      return NextResponse.json({ error: 'Recipient ID required' }, { status: 400 })
    }

    if (!itemId || typeof itemId !== 'number') {
      return NextResponse.json({ error: 'Item ID required' }, { status: 400 })
    }

    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) {
      return NextResponse.json({ error: 'Valid quantity required' }, { status: 400 })
    }

    // Member ID or Discord ID -> Discord ID of a real member (never a new orphan row).
    let recipientId: string
    try {
      recipientId = await resolvePepRecipient(toUserId)
    } catch (e) {
      if (e instanceof ValidationError) return NextResponse.json({ error: e.message }, { status: 400 })
      throw e
    }

    if (recipientId === session.discordId) {
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
    await getOrCreateEconomy(recipientId)

    // Transfer the item
    await prisma.$transaction(async (tx: any) => {
      // Atomically decrement the sender only if they still hold enough.
      // (Prevents concurrent sends from duplicating items.)
      const debit = await tx.inventory.updateMany({
        where: { userId: session.discordId, itemId, quantity: { gte: quantity } },
        data: { quantity: { decrement: quantity } }
      })
      if (debit.count !== 1) {
        throw new Error('Insufficient items in inventory')
      }
      // Remove the row if it hit zero
      await tx.inventory.deleteMany({
        where: { userId: session.discordId, itemId, quantity: { lte: 0 } }
      })

      // Add to recipient (upsert)
      await tx.inventory.upsert({
        where: {
          userId_itemId: { userId: recipientId, itemId }
        },
        create: {
          userId: recipientId,
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
      message: `Sent ${quantity}x ${senderInventory.item.name} to ${recipientId}`
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
