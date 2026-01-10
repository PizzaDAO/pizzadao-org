import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { giveUpBounty } from '@/app/lib/bounties'
import { requireOnboarded } from '@/app/lib/economy'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()

    if (!session?.discordId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    await requireOnboarded(session.discordId)

    const body = await request.json()
    const { bountyId } = body

    if (!bountyId || typeof bountyId !== 'number') {
      return NextResponse.json({ error: 'Bounty ID required' }, { status: 400 })
    }

    const bounty = await giveUpBounty(session.discordId, bountyId)

    return NextResponse.json({
      success: true,
      message: 'You gave up the bounty. It is now open for others.',
      bounty: {
        id: bounty.id,
        description: bounty.description,
        reward: bounty.reward,
        status: bounty.status
      }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
