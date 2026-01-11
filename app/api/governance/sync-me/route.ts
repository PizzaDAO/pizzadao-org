import { NextRequest, NextResponse } from 'next/server'
import { syncUserToGroups } from '@/app/lib/batch-sync'
import { prisma } from '@/app/lib/db'

// POST: Sync current user to all groups they're eligible for
export async function POST(request: NextRequest) {
  try {
    // Get discordId from request body or query params
    const body = await request.json().catch(() => ({}))
    const discordId = body.discordId

    if (!discordId) {
      // Try to get from identity table using commitment
      const commitment = body.commitment
      if (commitment) {
        const identity = await prisma.userIdentity.findUnique({
          where: { commitment },
        })
        if (identity) {
          const result = await syncUserToGroups(identity.discordId)
          return NextResponse.json({ success: true, ...result })
        }
      }
      return NextResponse.json({ error: 'Discord ID required' }, { status: 400 })
    }

    const result = await syncUserToGroups(discordId)

    return NextResponse.json({
      success: true,
      ...result,
    })
  } catch (error) {
    console.error('Failed to sync user:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to sync' },
      { status: 500 }
    )
  }
}
