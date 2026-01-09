import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { hasAnyRole } from '@/app/lib/discord'
import { prisma } from '@/app/lib/db'
import { ADMIN_ROLE_IDS } from '@/app/ui/constants'

type Params = { params: Promise<{ pollId: string }> }

// GET /api/polls/[pollId] - Get single poll
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

  // Only include results for closed polls
  return NextResponse.json({
    ...poll,
    results: poll.status === 'CLOSED' ? poll.results : [],
  })
}

// PATCH /api/polls/[pollId] - Update poll (admin only)
export async function PATCH(req: Request, { params }: Params) {
  const { pollId } = await params
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const isAdmin = await hasAnyRole(session.discordId, ADMIN_ROLE_IDS)
  if (!isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const poll = await prisma.poll.findUnique({ where: { id: pollId } })
  if (!poll) {
    return NextResponse.json({ error: 'Poll not found' }, { status: 404 })
  }

  const body = await req.json()
  const { status, question, options } = body

  // Only allow editing question/options if poll is still DRAFT
  if ((question || options) && poll.status !== 'DRAFT') {
    return NextResponse.json(
      { error: 'Cannot edit poll after it has been opened' },
      { status: 400 }
    )
  }

  // Validate status transition
  if (status) {
    const validTransitions: Record<string, string[]> = {
      DRAFT: ['OPEN'],
      OPEN: ['CLOSED'],
      CLOSED: [],
    }
    if (!validTransitions[poll.status]?.includes(status)) {
      return NextResponse.json(
        { error: `Cannot transition from ${poll.status} to ${status}` },
        { status: 400 }
      )
    }
  }

  const updated = await prisma.poll.update({
    where: { id: pollId },
    data: {
      ...(question && { question }),
      ...(options && { options }),
      ...(status && { status }),
    },
  })

  return NextResponse.json(updated)
}

// DELETE /api/polls/[pollId] - Delete poll (admin only, draft only)
export async function DELETE(req: Request, { params }: Params) {
  const { pollId } = await params
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const isAdmin = await hasAnyRole(session.discordId, ADMIN_ROLE_IDS)
  if (!isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const poll = await prisma.poll.findUnique({ where: { id: pollId } })
  if (!poll) {
    return NextResponse.json({ error: 'Poll not found' }, { status: 404 })
  }

  if (poll.status !== 'DRAFT') {
    return NextResponse.json(
      { error: 'Can only delete draft polls' },
      { status: 400 }
    )
  }

  await prisma.poll.delete({ where: { id: pollId } })

  return NextResponse.json({ success: true })
}
