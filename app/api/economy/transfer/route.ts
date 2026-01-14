import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { transfer, requireOnboarded, formatCurrency } from '@/app/lib/economy'
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
  const { toUserId, amount } = body

  if (!toUserId || typeof toUserId !== 'string') {
    throw new ValidationError('Recipient user ID required')
  }

  if (!amount || typeof amount !== 'number' || amount <= 0) {
    throw new ValidationError('Valid positive amount required')
  }

  const result = await transfer(session.discordId, toUserId, Math.floor(amount))

  return NextResponse.json({
    success: true,
    message: `Transferred ${formatCurrency(result.amount)} to user`,
    amount: result.amount
  })
}

export const POST = withErrorHandling(POST_HANDLER)
