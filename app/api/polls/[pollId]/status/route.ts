import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { hasRole } from '@/app/lib/discord'
import { prisma } from '@/app/lib/db'

type Params = { params: Promise<{ pollId: string }> }

// GET /api/polls/[pollId]/status - Get current user's status for this poll
export async function GET(req: Request, { params }: Params) {
  const { pollId } = await params
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    include: { results: true },
  })

  if (!poll) {
    return NextResponse.json({ error: 'Poll not found' }, { status: 404 })
  }

  // Check eligibility
  const isEligible = await hasRole(session.discordId, poll.requiredRoleId)

  // Check if user has claimed a token
  const hasClaimed = await prisma.pendingSignature.findUnique({
    where: {
      userId_pollId: {
        userId: session.discordId,
        pollId: pollId,
      },
    },
  })

  return NextResponse.json({
    poll: {
      id: poll.id,
      question: poll.question,
      options: poll.options,
      status: poll.status,
      requiredRoleId: poll.requiredRoleId,
      // Only include results if poll is closed
      results: poll.status === 'CLOSED' ? poll.results : undefined,
    },
    user: {
      isEligible,
      hasClaimedToken: !!hasClaimed,
    },
  })
}
