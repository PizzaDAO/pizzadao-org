import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { buyItem } from '@/app/lib/shop'
import { requireOnboarded, formatCurrency } from '@/app/lib/economy'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { UnauthorizedError, ValidationError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'

const POST_HANDLER = async (request: NextRequest) => {
  const session = await getSession()

  if (!session?.discordId) {
    throw new UnauthorizedError()
  }

  await requireOnboarded(session.discordId)

  const body = await request.json()
  const { itemId, quantity = 1 } = body

  if (!itemId || typeof itemId !== 'number') {
    throw new ValidationError('Valid item ID required')
  }

  if (typeof quantity !== 'number' || quantity <= 0) {
    throw new ValidationError('Valid positive quantity required')
  }

  const result = await buyItem(session.discordId, itemId, Math.floor(quantity))

  return NextResponse.json({
    success: true,
    message: `Purchased ${result.quantity}x ${result.item} for ${formatCurrency(result.totalCost)}`,
    item: result.item,
    quantity: result.quantity,
    totalCost: result.totalCost
  })
}

export const POST = withErrorHandling(POST_HANDLER)
