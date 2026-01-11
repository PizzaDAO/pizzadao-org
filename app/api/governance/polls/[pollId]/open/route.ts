import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/db'
import { syncGroupMembers } from '@/app/lib/batch-sync'

interface RouteParams {
  params: Promise<{ pollId: string }>
}

/**
 * POST /api/governance/polls/[pollId]/open
 *
 * Open a poll and trigger batch sync of all eligible voters.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { pollId } = await params

    // Get poll
    const poll = await prisma.anonPoll.findUnique({
      where: { id: pollId },
      include: { group: true },
    })

    if (!poll) {
      return NextResponse.json({ error: 'Poll not found' }, { status: 404 })
    }

    if (poll.status !== 'DRAFT') {
      return NextResponse.json(
        { error: `Poll is already ${poll.status}` },
        { status: 400 }
      )
    }

    // Batch sync all eligible members to the group
    const syncResult = await syncGroupMembers(poll.groupId)

    // Update poll status to OPEN
    const updatedPoll = await prisma.anonPoll.update({
      where: { id: pollId },
      data: { status: 'OPEN' },
      include: {
        group: {
          select: {
            id: true,
            name: true,
            discordRoleName: true,
            memberCount: true,
          },
        },
      },
    })

    return NextResponse.json({
      poll: updatedPoll,
      sync: syncResult,
    })
  } catch (error) {
    console.error('Failed to open poll:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to open poll' },
      { status: 500 }
    )
  }
}
