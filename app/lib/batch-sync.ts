// Batch sync utilities for adding members to Semaphore groups

import { Group } from '@semaphore-protocol/core'
import { prisma } from './db'
import { getRoleMembers } from './discord-bot'

interface SyncResult {
  groupId: string
  groupName: string
  addedCount: number
  alreadyMemberCount: number
  noIdentityCount: number
}

/**
 * Sync all eligible members to a Semaphore group
 * Called when a poll opens or when syncing a specific group
 */
export async function syncGroupMembers(groupId: string): Promise<SyncResult> {
  // Get group details
  const group = await prisma.semaphoreGroup.findUnique({
    where: { id: groupId },
    include: { members: true },
  })

  if (!group) {
    throw new Error(`Group not found: ${groupId}`)
  }

  // Get all Discord users with this role
  const roleMembers = await getRoleMembers(group.discordRoleId)

  // Get all users who have identity commitments
  const identities = await prisma.userIdentity.findMany({
    where: {
      discordId: { in: roleMembers },
    },
  })

  // Build set of existing commitments
  const existingCommitments = new Set(group.members.map(m => m.commitment))

  // Find users to add (have identity, have role, not yet in group)
  const toAdd = identities.filter(id => !existingCommitments.has(id.commitment))

  if (toAdd.length === 0) {
    return {
      groupId,
      groupName: group.name,
      addedCount: 0,
      alreadyMemberCount: group.members.length,
      noIdentityCount: roleMembers.length - identities.length,
    }
  }

  // Reconstruct the Semaphore group to get new merkle root
  const semaphoreGroup = new Group()
  for (const member of group.members) {
    semaphoreGroup.addMember(BigInt(member.commitment))
  }

  // Add new members
  let nextIndex = group.memberCount
  const newMembers = []

  for (const identity of toAdd) {
    semaphoreGroup.addMember(BigInt(identity.commitment))
    newMembers.push({
      groupId,
      commitment: identity.commitment,
      index: nextIndex++,
    })
  }

  // Update database in transaction
  await prisma.$transaction([
    prisma.semaphoreGroupMember.createMany({
      data: newMembers,
    }),
    prisma.semaphoreGroup.update({
      where: { id: groupId },
      data: {
        merkleRoot: semaphoreGroup.root.toString(),
        memberCount: nextIndex,
      },
    }),
  ])

  return {
    groupId,
    groupName: group.name,
    addedCount: toAdd.length,
    alreadyMemberCount: group.members.length,
    noIdentityCount: roleMembers.length - identities.length,
  }
}

/**
 * Sync a single user to all groups they're eligible for (based on current roles)
 * Called when user visits the governance page
 */
export async function syncUserToGroups(discordId: string): Promise<{
  syncedGroups: string[]
  alreadyMemberGroups: string[]
}> {
  const log = (msg: string) => console.log(`[SyncUser ${discordId.slice(-6)}] ${msg}`)

  // Get user's identity
  const identity = await prisma.userIdentity.findUnique({
    where: { discordId },
  })

  if (!identity) {
    log('No identity found in DB')
    return { syncedGroups: [], alreadyMemberGroups: [] }
  }
  log(`Found identity with commitment ${identity.commitment.slice(0, 10)}...`)

  // Get user's current Discord roles
  const { getUserRoles } = await import('./discord-bot')
  const userRoles = await getUserRoles(discordId)
  log(`User has ${userRoles.length} Discord roles: ${userRoles.join(', ')}`)

  // Get all groups for open polls that match user's roles
  const openPolls = await prisma.anonPoll.findMany({
    where: { status: 'OPEN' },
    include: {
      group: {
        include: { members: true },
      },
    },
  })
  log(`Found ${openPolls.length} open polls`)

  const syncedGroups: string[] = []
  const alreadyMemberGroups: string[] = []

  for (const poll of openPolls) {
    const group = poll.group
    log(`Checking poll "${poll.question}" - requires role ${group.discordRoleId} (${group.discordRoleName})`)

    // Check if user has the required role
    if (!userRoles.includes(group.discordRoleId)) {
      log(`User does NOT have required role ${group.discordRoleId}`)
      continue
    }
    log(`User HAS required role`)

    // Check if already a member
    const isMember = group.members.some(m => m.commitment === identity.commitment)
    if (isMember) {
      log(`Already a member of group ${group.name}`)
      alreadyMemberGroups.push(group.name)
      continue
    }

    log(`Adding user to group ${group.name}...`)
    // Add user to group - use try/catch to handle race conditions
    try {
      const semaphoreGroup = new Group()
      for (const member of group.members) {
        semaphoreGroup.addMember(BigInt(member.commitment))
      }
      semaphoreGroup.addMember(BigInt(identity.commitment))

      await prisma.$transaction([
        prisma.semaphoreGroupMember.create({
          data: {
            groupId: group.id,
            commitment: identity.commitment,
            index: group.memberCount,
          },
        }),
        prisma.semaphoreGroup.update({
          where: { id: group.id },
          data: {
            merkleRoot: semaphoreGroup.root.toString(),
            memberCount: group.memberCount + 1,
          },
        }),
      ])

      log(`Successfully added to group ${group.name}`)
      syncedGroups.push(group.name)
    } catch (error: unknown) {
      // Handle unique constraint violation (user already added by another request)
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
        log(`Already added by another request to ${group.name}`)
        alreadyMemberGroups.push(group.name)
      } else {
        log(`ERROR adding to group: ${error}`)
        throw error
      }
    }
  }

  log(`Done. Synced: [${syncedGroups.join(', ')}], Already member: [${alreadyMemberGroups.join(', ')}]`)
  return { syncedGroups, alreadyMemberGroups }
}
