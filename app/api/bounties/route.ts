import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { getAllBounties, createBounty } from '@/app/lib/bounties'
import { requireOnboarded } from '@/app/lib/economy'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { UnauthorizedError, ValidationError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'

// GET - List all bounties
export async function GET() {
  try {
    const bounties = await getAllBounties()

    return NextResponse.json({
      bounties: bounties.map((b: any) => ({
        id: b.id,
        description: b.description,
        link: b.link,
        reward: b.reward,
        createdBy: b.createdBy,
        claimedBy: b.claimedBy,
        status: b.status,
        createdAt: b.createdAt.toISOString(),
        commentCount: b._count.comments
      }))
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// POST - Create a new bounty
const POST_HANDLER = async (request: NextRequest) => {
  const session = await getSession()

  if (!session?.discordId) {
    throw new UnauthorizedError()
  }

  await requireOnboarded(session.discordId)

  const body = await request.json()
  const { description, reward, link } = body

  if (!description || typeof description !== 'string') {
    throw new ValidationError('Description required')
  }

  if (!reward || typeof reward !== 'number' || reward <= 0) {
    throw new ValidationError('Valid reward amount required')
  }

  const bounty = await createBounty(session.discordId, description, reward, link)

  return NextResponse.json({
    success: true,
    bounty: {
      id: bounty.id,
      description: bounty.description,
      link: bounty.link,
      reward: bounty.reward,
      status: bounty.status,
      createdAt: bounty.createdAt.toISOString()
    }
  })
}

export const POST = withErrorHandling(POST_HANDLER)
