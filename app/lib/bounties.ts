import { prisma } from './db'
import { creditInTx, debitInTx, getOrCreateEconomy } from './economy'
import { ValidationError, NotFoundError, ForbiddenError, ConflictError } from './errors/api-errors'
import { notifyBountyClaimed, notifyBountyCompleted, notifyBountyComment } from './notifications'
import { getCrewMappings } from './crew-mappings'
import { CREW_ID_PATTERN, normalizeCrewId } from './crew-id'

/**
 * Resolve an optional crew tag for a bounty (jalapeno-82565).
 *
 * Returns the crew-mappings slug, or null for a general bounty. Throws a
 * ValidationError when a crew is given but doesn't match a known crew.
 */
export async function resolveBountyCrewId(raw: unknown): Promise<string | null> {
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw !== 'string') {
    throw new ValidationError('crewId must be a string')
  }
  const crewId = normalizeCrewId(raw)
  if (!crewId || !CREW_ID_PATTERN.test(crewId)) {
    throw new ValidationError('Invalid crewId')
  }
  const { crews } = await getCrewMappings()
  if (!crews.some((c) => c.id === crewId)) {
    throw new ValidationError(`Unknown crew: ${crewId}`)
  }
  return crewId
}

/**
 * Map crew IDs to their display labels. Fails soft (empty map) so a
 * crew-mappings outage never breaks bounty listings.
 */
export async function getCrewLabelMap(): Promise<Map<string, string>> {
  try {
    const { crews } = await getCrewMappings()
    return new Map(crews.map((c) => [c.id, c.label]))
  } catch {
    return new Map()
  }
}

export type BountyListFilter = {
  /** Only return bounties tagged with this crew (crew-mappings slug). */
  crewId?: string | null
}

function crewWhere(filter?: BountyListFilter) {
  const crewId = filter?.crewId ? normalizeCrewId(filter.crewId) : ''
  return crewId ? { crewId } : {}
}

/**
 * Create a bounty with escrowed reward.
 *
 * Anyone who can post a bounty can tag it for a crew (crew leads included);
 * `crewId` must already be resolved via `resolveBountyCrewId`.
 *
 * The escrow debit, its ledger row and the bounty row are written in one DB
 * transaction: either the PEP is escrowed against a bounty, or nothing happens.
 */
export async function createBounty(
  creatorId: string,
  description: string,
  reward: number,
  link?: string,
  crewId?: string | null,
) {
  if (!Number.isInteger(reward) || reward <= 0) {
    throw new ValidationError('Reward must be a positive whole number')
  }

  if (!description.trim()) {
    throw new ValidationError('Description is required')
  }

  // Friendly fast path; the conditional debit in debitInTx is authoritative.
  const economy = await getOrCreateEconomy(creatorId)
  if (economy.wallet < reward) {
    throw new ValidationError('Insufficient funds to escrow reward')
  }

  return prisma.$transaction(async (tx) => {
    const bounty = await tx.bounty.create({
      data: {
        description: description.trim(),
        link: link?.trim() || null,
        reward,
        createdBy: creatorId,
        status: 'OPEN',
        crewId: crewId || null
      }
    })
    try {
      await debitInTx(tx, creatorId, reward, 'BOUNTY_ESCROW', `Bounty escrow: ${description.trim()}`, { bountyId: bounty.id })
    } catch (e) {
      if (e instanceof ValidationError) throw new ValidationError('Insufficient funds to escrow reward')
      throw e
    }
    return bounty
  })
}

/**
 * Get all open bounties
 */
export async function getOpenBounties(filter?: BountyListFilter) {
  return prisma.bounty.findMany({
    where: { status: 'OPEN', ...crewWhere(filter) },
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
 * Claim an open bounty.
 *
 * The OPEN -> CLAIMED transition is a conditional update, so of N concurrent
 * claims exactly one wins.
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

  const claimed = await prisma.bounty.updateMany({
    where: { id: bountyId, status: 'OPEN' },
    data: {
      claimedBy: userId,
      status: 'CLAIMED'
    }
  })
  if (claimed.count !== 1) {
    throw new ConflictError('Bounty is not available')
  }

  // Notify the bounty poster (fire and forget - don't block on notification)
  notifyBountyClaimed(bounty.createdBy, userId, bountyId, bounty.description).catch(() => {})

  return { ...bounty, claimedBy: userId, status: 'CLAIMED' as const }
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

  const released = await prisma.bounty.updateMany({
    where: { id: bountyId, status: 'CLAIMED', claimedBy: userId },
    data: {
      claimedBy: null,
      status: 'OPEN'
    }
  })
  if (released.count !== 1) {
    throw new ConflictError('Bounty is not in claimed status')
  }

  return { ...bounty, claimedBy: null, status: 'OPEN' as const }
}

/**
 * Complete a bounty (creator approves, escrowed reward paid to claimer).
 *
 * The CLAIMED -> COMPLETED transition is a conditional update in the same DB
 * transaction as the payout and its ledger row, so the escrow is released
 * exactly once even if complete is double-submitted or races a cancel.
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
  const claimerId = bounty.claimedBy

  await getOrCreateEconomy(claimerId)

  await prisma.$transaction(async (tx) => {
    const done = await tx.bounty.updateMany({
      where: { id: bountyId, createdBy: creatorId, status: 'CLAIMED', claimedBy: claimerId },
      data: { status: 'COMPLETED' }
    })
    if (done.count !== 1) {
      throw new ConflictError('Bounty is no longer awaiting completion')
    }
    await creditInTx(tx, claimerId, bounty.reward, 'BOUNTY_REWARD', `Bounty reward: ${bounty.description}`, { bountyId })
  })

  // Notify the claimer (fire and forget - don't block on notification)
  notifyBountyCompleted(claimerId, creatorId, bountyId, bounty.description, bounty.reward).catch(() => {})

  return { ...bounty, status: 'COMPLETED' as const }
}

/**
 * Cancel a bounty (creator cancels, escrowed reward refunded).
 *
 * Same pattern as completeBounty: the status transition, the refund and its
 * ledger row commit together, and only one of any concurrent complete/cancel
 * calls can win.
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

  await getOrCreateEconomy(creatorId)

  await prisma.$transaction(async (tx) => {
    const cancelled = await tx.bounty.updateMany({
      where: { id: bountyId, createdBy: creatorId, status: { in: ['OPEN', 'CLAIMED'] } },
      data: { status: 'CANCELLED' }
    })
    if (cancelled.count !== 1) {
      throw new ConflictError('Bounty can no longer be cancelled')
    }
    await creditInTx(tx, creatorId, bounty.reward, 'BOUNTY_REFUND', `Bounty refund: ${bounty.description}`, { bountyId })
  })

  return { ...bounty, status: 'CANCELLED' as const }
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
 * Get all bounties (for listing) with comment counts
 */
export async function getAllBounties(filter?: BountyListFilter) {
  return prisma.bounty.findMany({
    where: {
      status: { in: ['OPEN', 'CLAIMED'] },
      ...crewWhere(filter)
    },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: { comments: true }
      }
    }
  })
}

/**
 * Get comments for a bounty
 */
export async function getBountyComments(bountyId: number) {
  const bounty = await prisma.bounty.findUnique({
    where: { id: bountyId }
  })

  if (!bounty) {
    throw new NotFoundError('Bounty')
  }

  return prisma.bountyComment.findMany({
    where: { bountyId },
    orderBy: { createdAt: 'asc' }
  })
}

/**
 * Add a comment to a bounty (only creator or claimer can comment)
 */
export async function addBountyComment(userId: string, bountyId: number, content: string) {
  if (!content.trim()) {
    throw new ValidationError('Comment content is required')
  }

  const bounty = await prisma.bounty.findUnique({
    where: { id: bountyId }
  })

  if (!bounty) {
    throw new NotFoundError('Bounty')
  }

  // Only the bounty creator or claimer can comment
  if (bounty.createdBy !== userId && bounty.claimedBy !== userId) {
    throw new ForbiddenError('Only the bounty creator or claimer can post comments')
  }

  const comment = await prisma.bountyComment.create({
    data: {
      bountyId,
      authorId: userId,
      content: content.trim()
    }
  })

  // Send notifications to all involved parties (fire and forget)
  notifyBountyComment(userId, bountyId, bounty.description, bounty.createdBy, bounty.claimedBy).catch(() => {})

  return comment
}

/**
 * Delete a comment (only the author can delete their own comment)
 */
export async function deleteBountyComment(userId: string, commentId: number) {
  const comment = await prisma.bountyComment.findUnique({
    where: { id: commentId }
  })

  if (!comment) {
    throw new NotFoundError('Comment')
  }

  if (comment.authorId !== userId) {
    throw new ForbiddenError('You can only delete your own comments')
  }

  return prisma.bountyComment.delete({
    where: { id: commentId }
  })
}
