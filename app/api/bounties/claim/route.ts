import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { claimBounty } from '@/app/lib/bounties'
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

    const bounty = await claimBounty(session.discordId, bountyId)

    return NextResponse.json({
      success: true,
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
