import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/governance/polls
 *
 * Get all anonymous polls.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const groupId = searchParams.get('groupId')

    const where: Record<string, unknown> = {}
    if (status) where.status = status
    if (groupId) where.groupId = groupId

    const polls = await prisma.anonPoll.findMany({
      where,
      include: {
        group: {
          select: {
            id: true,
            name: true,
            discordRoleName: true,
            memberCount: true,
          },
        },
        results: true,
        _count: {
          select: { nullifiers: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Sanitize polls - hide results until closed
    const sanitizedPolls = polls.map(poll => ({
      id: poll.id,
      question: poll.question,
      description: poll.description,
      options: poll.options,
      groupId: poll.groupId,
      category: poll.category,
      status: poll.status,
      createdAt: poll.createdAt,
      closesAt: poll.closesAt,
      group: poll.group,
      // Only show results if poll is closed
      results: poll.status === 'CLOSED' ? poll.results : undefined,
      // Don't show vote count during voting (anonymity)
      voteCount: poll.status === 'CLOSED' ? poll._count.nullifiers : undefined,
    }))

    return NextResponse.json(sanitizedPolls)

  } catch (error) {
    console.error('Failed to get polls:', error)
    return NextResponse.json(
      { error: 'Failed to get polls' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/governance/polls
 *
 * Create a new anonymous poll.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { question, description, options, groupId, category, closesAt, createdBy } = body

    if (!question || !options || !groupId || !createdBy) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    if (!Array.isArray(options) || options.length < 2) {
      return NextResponse.json(
        { error: 'At least 2 options are required' },
        { status: 400 }
      )
    }

    // Verify group exists
    const group = await prisma.semaphoreGroup.findUnique({
      where: { id: groupId },
    })

    if (!group) {
      return NextResponse.json(
        { error: 'Group not found' },
        { status: 404 }
      )
    }

    // Create poll
    const poll = await prisma.anonPoll.create({
      data: {
        question,
        description,
        options,
        groupId,
        category: category || 'ALL',
        closesAt: closesAt ? new Date(closesAt) : null,
        createdBy,
        status: 'DRAFT',
      },
      include: {
        group: {
          select: {
            id: true,
            name: true,
            discordRoleName: true,
          },
        },
      },
    })

    // Initialize result counters
    await prisma.anonPollResult.createMany({
      data: options.map((_: string, index: number) => ({
        pollId: poll.id,
        optionIndex: index,
        count: 0,
      })),
    })

    return NextResponse.json(poll, { status: 201 })

  } catch (error) {
    console.error('Failed to create poll:', error)
    return NextResponse.json(
      { error: 'Failed to create poll' },
      { status: 500 }
    )
  }
}
