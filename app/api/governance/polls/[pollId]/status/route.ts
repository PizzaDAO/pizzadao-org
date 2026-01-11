import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/db'

/**
 * PATCH /api/governance/polls/[pollId]/status
 *
 * Update poll status (DRAFT -> OPEN -> CLOSED)
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ pollId: string }> }
) {
  try {
    const { pollId } = await params
    const body = await req.json()
    const { status } = body

    if (!status || !['DRAFT', 'OPEN', 'CLOSED'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status. Must be DRAFT, OPEN, or CLOSED' },
        { status: 400 }
      )
    }

    const poll = await prisma.anonPoll.findUnique({
      where: { id: pollId },
    })

    if (!poll) {
      return NextResponse.json(
        { error: 'Poll not found' },
        { status: 404 }
      )
    }

    const updated = await prisma.anonPoll.update({
      where: { id: pollId },
      data: { status },
      include: {
        group: {
          select: {
            id: true,
            name: true,
            discordRoleName: true,
          },
        },
        results: true,
      },
    })

    return NextResponse.json(updated)
  } catch (error) {
    console.error('Failed to update poll status:', error)
    return NextResponse.json(
      { error: 'Failed to update poll status' },
      { status: 500 }
    )
  }
}
