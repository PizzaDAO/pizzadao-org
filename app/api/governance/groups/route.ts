import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/app/lib/db'

/**
 * GET /api/governance/groups
 *
 * List all Semaphore groups.
 */
export async function GET() {
  try {
    const groups = await prisma.semaphoreGroup.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { members: true, polls: true },
        },
      },
    })

    return NextResponse.json(groups)
  } catch (error) {
    console.error('Failed to get groups:', error)
    return NextResponse.json(
      { error: 'Failed to get groups' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/governance/groups
 *
 * Create a new Semaphore group.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, discordRoleId, discordRoleName, category } = body

    if (!name || !discordRoleId || !discordRoleName) {
      return NextResponse.json(
        { error: 'Missing required fields: name, discordRoleId, discordRoleName' },
        { status: 400 }
      )
    }

    // Check if group already exists for this role + category
    const existing = await prisma.semaphoreGroup.findUnique({
      where: {
        discordRoleId_category: {
          discordRoleId,
          category: category || 'ALL',
        },
      },
    })

    if (existing) {
      return NextResponse.json(
        { error: 'Group already exists for this role and category' },
        { status: 409 }
      )
    }

    const group = await prisma.semaphoreGroup.create({
      data: {
        name,
        discordRoleId,
        discordRoleName,
        category: category || 'ALL',
        merkleRoot: '0', // Empty tree
        memberCount: 0,
      },
    })

    return NextResponse.json(group, { status: 201 })
  } catch (error) {
    console.error('Failed to create group:', error)
    return NextResponse.json(
      { error: 'Failed to create group' },
      { status: 500 }
    )
  }
}
