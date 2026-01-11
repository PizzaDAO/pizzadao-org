import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/db'
import { syncGroupMembers } from '@/app/lib/batch-sync'

// Default voting group - Pockets Checked role holders
const DEFAULT_GROUP = {
  discordRoleId: '926922069600501830',
  discordRoleName: 'pockets checked',
  name: 'Pockets Checked Voters',
}

/**
 * Ensure the default voting group exists
 */
async function ensureDefaultGroup() {
  let group = await prisma.semaphoreGroup.findFirst({
    where: { discordRoleId: DEFAULT_GROUP.discordRoleId },
  })

  if (!group) {
    group = await prisma.semaphoreGroup.create({
      data: {
        name: DEFAULT_GROUP.name,
        discordRoleId: DEFAULT_GROUP.discordRoleId,
        discordRoleName: DEFAULT_GROUP.discordRoleName,
        category: 'ALL',
        merkleRoot: '0',
        memberCount: 0,
      },
    })
  }

  return group
}

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
    const { question, description, options, category, closesAt, createdBy } = body

    if (!question || !options || !createdBy) {
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

    // Get or create the default group (leonardo role)
    const group = await ensureDefaultGroup()

    // Determine initial status
    const initialStatus = body.status === 'OPEN' ? 'OPEN' : 'DRAFT'

    // If creating as OPEN, try to sync group (but don't fail if sync fails)
    let syncResult = null
    if (initialStatus === 'OPEN') {
      try {
        syncResult = await syncGroupMembers(group.id)
      } catch (syncError) {
        console.warn('Group sync failed, poll will still be created:', syncError)
        // Poll will still be created - users can sync when they visit
      }
    }

    // Create poll
    const poll = await prisma.anonPoll.create({
      data: {
        question,
        description,
        options,
        groupId: group.id,
        category: category || 'ALL',
        closesAt: closesAt ? new Date(closesAt) : null,
        createdBy,
        status: initialStatus,
      },
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

    // Initialize result counters
    await prisma.anonPollResult.createMany({
      data: options.map((_: string, index: number) => ({
        pollId: poll.id,
        optionIndex: index,
        count: 0,
      })),
    })

    return NextResponse.json({
      ...poll,
      sync: syncResult,
    }, { status: 201 })

  } catch (error) {
    console.error('Failed to create poll:', error)
    return NextResponse.json(
      { error: 'Failed to create poll' },
      { status: 500 }
    )
  }
}
