import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { cancelBounty } from '@/app/lib/bounties'
import { requireOnboarded } from '@/app/lib/economy'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { UnauthorizedError, ValidationError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'

// Errors map to their ApiError status (401/403/404/409/400) via withErrorHandling.
const POST_HANDLER = async (request: NextRequest) => {
  const session = await getSession()

  if (!session?.discordId) {
    throw new UnauthorizedError()
  }

  await requireOnboarded(session.discordId)

  const body = await request.json()
  const { bountyId } = body

  if (!bountyId || typeof bountyId !== 'number') {
    throw new ValidationError('Bounty ID required')
  }

  const bounty = await cancelBounty(session.discordId, bountyId)

  return NextResponse.json({
    success: true,
    message: 'Bounty cancelled. Reward refunded.',
    bounty: {
      id: bounty.id,
      description: bounty.description,
      reward: bounty.reward,
      status: bounty.status
    }
  })
}

export const POST = withErrorHandling(POST_HANDLER)
