import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/governance/groups/[groupId]
 *
 * Get a Semaphore group with its members.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  try {
    const { groupId } = await params

    const group = await prisma.semaphoreGroup.findUnique({
      where: { id: groupId },
      include: {
        members: {
          orderBy: { index: 'asc' },
          select: {
            commitment: true,
            index: true,
          },
        },
      },
    })

    if (!group) {
      return NextResponse.json(
        { error: 'Group not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      id: group.id,
      name: group.name,
      discordRoleName: group.discordRoleName,
      category: group.category,
      merkleRoot: group.merkleRoot,
      memberCount: group.memberCount,
      members: group.members,
    })

  } catch (error) {
    console.error('Failed to get group:', error)
    return NextResponse.json(
      { error: 'Failed to get group' },
      { status: 500 }
    )
  }
}
