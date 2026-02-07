import { prisma } from './db'
import { getOrCreateEconomy, updateBalance } from './economy'
import { ValidationError, NotFoundError, ForbiddenError, ConflictError } from './errors/api-errors'
import { notifyBountyClaimed, notifyBountyCompleted } from './notifications'

/**
 * Create a bounty with escrowed reward
 */
export async function createBounty(creatorId: string, description: string, reward: number, link?: string) {
  if (reward <= 0) {
    throw new ValidationError('Reward must be positive')
  }

  if (!description.trim()) {
    throw new ValidationError('Description is required')
  }

  // Check creator has enough funds
  const economy = await getOrCreateEconomy(creatorId)
  if (economy.wallet < reward) {
    throw new ValidationError('Insufficient funds to escrow reward')
  }

  // Escrow the reward from creator's wallet
  await updateBalance(creatorId, -reward)

  // Create the bounty
  const bounty = await prisma.bounty.create({
    data: {
      description: description.trim(),
      link: link?.trim() || null,
      reward,
      createdBy: creatorId,
      status: 'OPEN'
    }
  })

  return bounty
}

/**
 * Get all open bounties
 */
export async function getOpenBounties() {
  return prisma.bounty.findMany({
    where: { status: 'OPEN' },
    orderBy: { createdAt: 'desc' }
  })
}

/**
 * Get bounties created by a user
 */
export async function getUserBounties(userId: string) {
  return prisma.bounty.findMany({
    where: { createdBy: userId },
    orderBy: { createdAt: 'desc' }
  })
}

/**
 * Get bounties claimed by a user
 */
export async function getClaimedBounties(userId: string) {
  return prisma.bounty.findMany({
    where: { claimedBy: userId, status: 'CLAIMED' },
    orderBy: { updatedAt: 'desc' }
  })
}

/**
 * Claim an open bounty
 */
export async function claimBounty(userId: string, bountyId: number) {
  const bounty = await prisma.bounty.findUnique({
    where: { id: bountyId }
  })

  if (!bounty) {
    throw new NotFoundError('Bounty')
  }

  if (bounty.status !== 'OPEN') {
    throw new ConflictError('Bounty is not available')
  }

  if (bounty.createdBy === userId) {
    throw new ValidationError('Cannot claim your own bounty')
  }

  const updatedBounty = await prisma.bounty.update({
    where: { id: bountyId },
    data: {
      claimedBy: userId,
      status: 'CLAIMED'
    }
  })

  // Notify the bounty poster (fire and forget - don't block on notification)
  notifyBountyClaimed(bounty.createdBy, userId, bountyId, bounty.description).catch(() => {})

  return updatedBounty
}

/**
 * Give up a claimed bounty (returns to OPEN status)
 */
export async function giveUpBounty(userId: string, bountyId: number) {
  const bounty = await prisma.bounty.findUnique({
    where: { id: bountyId }
  })

  if (!bounty) {
    throw new NotFoundError('Bounty')
  }

  if (bounty.claimedBy !== userId) {
    throw new ValidationError('You have not claimed this bounty')
  }

  if (bounty.status !== 'CLAIMED') {
    throw new ConflictError('Bounty is not in claimed status')
  }

  return prisma.bounty.update({
    where: { id: bountyId },
    data: {
      claimedBy: null,
      status: 'OPEN'
    }
  })
}

/**
 * Complete a bounty (creator approves, reward paid to claimer)
 */
export async function completeBounty(creatorId: string, bountyId: number) {
  const bounty = await prisma.bounty.findUnique({
    where: { id: bountyId }
  })

  if (!bounty) {
    throw new NotFoundError('Bounty')
  }

  if (bounty.createdBy !== creatorId) {
    throw new ForbiddenError('Only the bounty creator can complete it')
  }

  if (bounty.status !== 'CLAIMED') {
    throw new ConflictError('Bounty must be claimed before completion')
  }

  if (!bounty.claimedBy) {
    throw new ConflictError('No one has claimed this bounty')
  }

  // Pay the claimer
  await updateBalance(bounty.claimedBy, bounty.reward)

  // Mark as completed
  const updatedBounty = await prisma.bounty.update({
    where: { id: bountyId },
    data: { status: 'COMPLETED' }
  })

  // Notify the claimer (fire and forget - don't block on notification)
  notifyBountyCompleted(bounty.claimedBy, creatorId, bountyId, bounty.description, bounty.reward).catch(() => {})

  return updatedBounty
}

/**
 * Cancel a bounty (creator cancels, reward refunded)
 */
export async function cancelBounty(creatorId: string, bountyId: number) {
  const bounty = await prisma.bounty.findUnique({
    where: { id: bountyId }
  })

  if (!bounty) {
    throw new NotFoundError('Bounty')
  }

  if (bounty.createdBy !== creatorId) {
    throw new ForbiddenError('Only the bounty creator can cancel it')
  }

  if (bounty.status === 'COMPLETED') {
    throw new ConflictError('Cannot cancel a completed bounty')
  }

  if (bounty.status === 'CANCELLED') {
    throw new ConflictError('Bounty is already cancelled')
  }

  // Refund the creator
  await updateBalance(creatorId, bounty.reward)

  // Mark as cancelled
  return prisma.bounty.update({
    where: { id: bountyId },
    data: { status: 'CANCELLED' }
  })
}

/**
 * Get a single bounty by ID
 */
export async function getBounty(bountyId: number) {
  return prisma.bounty.findUnique({
    where: { id: bountyId }
  })
}

/**
 * Get all bounties (for listing)
 */
export async function getAllBounties() {
  return prisma.bounty.findMany({
    where: {
      status: { in: ['OPEN', 'CLAIMED'] }
    },
    orderBy: { createdAt: 'desc' }
  })
}
