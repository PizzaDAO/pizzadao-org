import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { getAllBounties, createBounty, resolveBountyCrewId, getCrewLabelMap } from '@/app/lib/bounties'
import { requireOnboarded } from '@/app/lib/economy'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { UnauthorizedError, ValidationError } from '@/app/lib/errors/api-errors'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'

export const runtime = 'nodejs'

// GET - List all bounties. Optional ?crewId=<slug> limits to one crew's bounties.
export async function GET(request: NextRequest) {
  try {
    const crewId = request.nextUrl.searchParams.get('crewId')
    const bounties = await getAllBounties({ crewId })
    const crewLabels = bounties.some((b) => b.crewId) ? await getCrewLabelMap() : new Map<string, string>()

    return NextResponse.json({
      bounties: bounties.map((b) => ({
        id: b.id,
        description: b.description,
        link: b.link,
        reward: b.reward,
        createdBy: b.createdBy,
        claimedBy: b.claimedBy,
        status: b.status,
        crewId: b.crewId ?? null,
        crewLabel: b.crewId ? (crewLabels.get(b.crewId) ?? b.crewId) : null,
        createdAt: b.createdAt.toISOString(),
        commentCount: b._count.comments
      }))
    }, {
      headers: NO_STORE_HEADERS
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE_HEADERS })
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

  // Optional crew tag (jalapeno-82565). Same permission as any bounty:
  // every onboarded member — crew leads included — can post a crew bounty.
  const crewId = await resolveBountyCrewId(body.crewId)

  const bounty = await createBounty(session.discordId, description, reward, link, crewId)

  return NextResponse.json({
    success: true,
    bounty: {
      id: bounty.id,
      description: bounty.description,
      link: bounty.link,
      reward: bounty.reward,
      status: bounty.status,
      crewId: bounty.crewId ?? null,
      createdAt: bounty.createdAt.toISOString()
    }
  })
}

export const POST = withErrorHandling(POST_HANDLER)
