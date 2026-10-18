import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { submitBounty } from '@/app/lib/bounties'
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
  const { bountyId, note, link } = body

  if (!bountyId || typeof bountyId !== 'number') {
    throw new ValidationError('Bounty ID required')
  }

  if (typeof note !== 'string') {
    throw new ValidationError('A note about your work is required')
  }
  if (link != null && typeof link !== 'string') {
    throw new ValidationError('Link must be a string')
  }

  const bounty = await submitBounty(session.discordId, bountyId, note, link)

  return NextResponse.json({
    success: true,
    message: 'Work submitted for review.',
    bounty: {
      id: bounty.id,
      description: bounty.description,
      reward: bounty.reward,
      status: bounty.status
    }
  })
}

export const POST = withErrorHandling(POST_HANDLER)
