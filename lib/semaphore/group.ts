import { Group } from '@semaphore-protocol/core'

/**
 * Voting group categories
 * Must match Prisma enum VotingCategory
 */
export enum VotingCategory {
  TREASURY = 'TREASURY',
  TECHNICAL = 'TECHNICAL',
  SOCIAL = 'SOCIAL',
  GOVERNANCE = 'GOVERNANCE',
  ALL = 'ALL',
}

/**
 * Group metadata stored in database
 */
export interface GroupMetadata {
  id: string
  category: VotingCategory
  discordRoleId: string
  discordRoleName: string
  merkleTreeRoot: string
  memberCount: number
  createdAt: Date
  updatedAt: Date
}

/**
 * Create a new Semaphore group.
 * Groups are identified by a unique ID derived from the Discord role.
 */
export function createGroup(groupId: string | bigint): Group {
  return new Group()
}

/**
 * Add a member (identity commitment) to a group.
 */
export function addMemberToGroup(group: Group, commitment: bigint): Group {
  group.addMember(commitment)
  return group
}

/**
 * Remove a member from a group.
 */
export function removeMemberFromGroup(group: Group, commitment: bigint): Group {
  group.removeMember(group.indexOf(commitment))
  return group
}

/**
 * Check if a commitment is a member of the group.
 */
export function isMemberOfGroup(group: Group, commitment: bigint): boolean {
  return group.indexOf(commitment) !== -1
}

/**
 * Get the Merkle root of the group.
 * This is used to verify proofs.
 */
export function getGroupRoot(group: Group): bigint {
  return group.root
}

/**
 * Get group membership proof for a member.
 */
export function getMembershipProof(group: Group, commitment: bigint) {
  const index = group.indexOf(commitment)
  if (index === -1) {
    throw new Error('Member not found in group')
  }
  return group.generateMerkleProof(index)
}

/**
 * Reconstruct a group from stored members.
 */
export function reconstructGroup(members: bigint[]): Group {
  const group = new Group()
  for (const member of members) {
    group.addMember(member)
  }
  return group
}

/**
 * Generate a unique group ID from Discord role ID and category.
 */
export function generateGroupId(discordRoleId: string, category: VotingCategory): bigint {
  // Create a deterministic group ID from role + category
  const combined = `${discordRoleId}:${category}`
  // Simple hash - in production use a proper hash function
  let hash = BigInt(0)
  for (let i = 0; i < combined.length; i++) {
    hash = (hash * BigInt(31) + BigInt(combined.charCodeAt(i))) % BigInt(2 ** 64)
  }
  return hash
}
