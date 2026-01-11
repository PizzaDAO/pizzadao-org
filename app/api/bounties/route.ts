import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { getAllBounties, createBounty } from '@/app/lib/bounties'
import { requireOnboarded } from '@/app/lib/economy'

export const runtime = 'nodejs'

// GET - List all bounties
export async function GET() {
  try {
    const bounties = await getAllBounties()

    return NextResponse.json({
      bounties: bounties.map(b => ({
        id: b.id,
        description: b.description,
        reward: b.reward,
        createdBy: b.createdBy,
        claimedBy: b.claimedBy,
        status: b.status,
        createdAt: b.createdAt.toISOString()
      }))
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// POST - Create a new bounty
export async function POST(request: NextRequest) {
  try {
    const session = await getSession()

    if (!session?.discordId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    await requireOnboarded(session.discordId)

    const body = await request.json()
    const { description, reward } = body

    if (!description || typeof description !== 'string') {
      return NextResponse.json({ error: 'Description required' }, { status: 400 })
    }

    if (!reward || typeof reward !== 'number' || reward <= 0) {
      return NextResponse.json({ error: 'Valid reward amount required' }, { status: 400 })
    }

    const bounty = await createBounty(session.discordId, description, reward)

    return NextResponse.json({
      success: true,
      bounty: {
        id: bounty.id,
        description: bounty.description,
        reward: bounty.reward,
        status: bounty.status,
        createdAt: bounty.createdAt.toISOString()
      }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
