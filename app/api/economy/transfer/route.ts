import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { transfer, requireOnboarded, formatCurrency } from '@/app/lib/economy'
import { resolvePepRecipient } from '@/app/lib/pep-recipient'
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

  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    throw new ValidationError('Amount must be a positive whole number')
  }

  // Member ID or Discord ID -> Discord ID of a real member (never a new orphan wallet).
  const recipientId = await resolvePepRecipient(toUserId)

  const result = await transfer(session.discordId, recipientId, amount)

  return NextResponse.json({
    success: true,
    message: `Transferred ${formatCurrency(result.amount)} to user`,
    amount: result.amount
  })
}

export const POST = withErrorHandling(POST_HANDLER)
