import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Group } from '@semaphore-protocol/core'

/**
 * POST /api/governance/groups/join
 *
 * Join a Semaphore group by registering an identity commitment.
 * The user must have the required Discord role.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { groupId, commitment, discordId } = body

    if (!groupId || !commitment || !discordId) {
      return NextResponse.json(
        { error: 'Missing required fields: groupId, commitment, discordId' },
        { status: 400 }
      )
    }

    // Get the group
    const group = await prisma.semaphoreGroup.findUnique({
      where: { id: groupId },
      include: { members: true },
    })

    if (!group) {
      return NextResponse.json(
        { error: 'Group not found' },
        { status: 404 }
      )
    }

    // TODO: Verify user has the required Discord role
    // This would require calling the Discord API

    // Check if already a member
    const existingMember = await prisma.semaphoreGroupMember.findUnique({
      where: {
        groupId_commitment: {
          groupId,
          commitment: commitment.toString(),
        },
      },
    })

    if (existingMember) {
      return NextResponse.json(
        { error: 'Already a member of this group' },
        { status: 400 }
      )
    }

    // Get the next index
    const nextIndex = group.memberCount

    // Reconstruct the Semaphore group and add the new member
    const semaphoreGroup = new Group()
    for (const member of group.members.sort((a, b) => a.index - b.index)) {
      semaphoreGroup.addMember(BigInt(member.commitment))
    }
    semaphoreGroup.addMember(BigInt(commitment))

    // Add member to database
    await prisma.$transaction([
      prisma.semaphoreGroupMember.create({
        data: {
          groupId,
          commitment: commitment.toString(),
          index: nextIndex,
        },
      }),
      prisma.semaphoreGroup.update({
        where: { id: groupId },
        data: {
          memberCount: nextIndex + 1,
          merkleRoot: semaphoreGroup.root.toString(),
        },
      }),
    ])

    return NextResponse.json({
      success: true,
      index: nextIndex,
      merkleRoot: semaphoreGroup.root.toString(),
    })

  } catch (error) {
    console.error('Failed to join group:', error)
    return NextResponse.json(
      { error: 'Failed to join group' },
      { status: 500 }
    )
  }
}
