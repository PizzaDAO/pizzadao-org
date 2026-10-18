import { prisma } from './db'
import { creditInTx, debitInTx, getOrCreateEconomy } from './economy'
import { ValidationError, NotFoundError, ForbiddenError, ConflictError } from './errors/api-errors'
import {
  notifyBountyClaimed,
  notifyBountyCompleted,
  notifyBountyComment,
  notifyBountySubmitted,
  notifyBountyRejected,
} from './notifications'
import { canManageBounty } from './crew-leads'
import { getCrewMappings } from './crew-mappings'
import { CREW_ID_PATTERN, normalizeCrewId } from './crew-id'
import { discordTextToPlainText } from './discord-markup'
import { resolveDiscordMentions } from './discord-mention-resolve'

/**
 * Resolve any <#channelId> / <@&roleId> Discord mentions in `description` so
 * a ledger memo (escrow/reward/refund) stores plain text, not raw markup —
 * same pattern as the job-reward memo in jobs.ts. resolveDiscordMentions
 * never throws (a failed Discord lookup just falls back to "#channel" /
 * "@role" instead of a name). keepTimestamps: true keeps a `<t:...>` tag
 * raw in the memo rather than freezing it to today's formatted
 * date/relative string — display-time rendering formats it fresh.
 */
async function plainMemoDescription(description: string): Promise<string> {
  const { channels, roles } = await resolveDiscordMentions([description])
  return discordTextToPlainText(description, { channels, roles }, { keepTimestamps: true })
}

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

  const trimmedDescription = description.trim()
  if (!trimmedDescription) {
    throw new ValidationError('Description is required')
  }

  // Friendly fast path; the conditional debit in debitInTx is authoritative.
  const economy = await getOrCreateEconomy(creatorId)
  if (economy.wallet < reward) {
    throw new ValidationError('Insufficient funds to escrow reward')
  }

  const plainDescription = await plainMemoDescription(trimmedDescription)

  return prisma.$transaction(async (tx) => {
    const bounty = await tx.bounty.create({
      data: {
        description: trimmedDescription,
        link: link?.trim() || null,
        reward,
        createdBy: creatorId,
        status: 'OPEN',
        crewId: crewId || null
      }
    })
    try {
      await debitInTx(tx, creatorId, reward, 'BOUNTY_ESCROW', `Bounty escrow: ${plainDescription}`, { bountyId: bounty.id })
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
    where: { claimedBy: userId, status: { in: ['CLAIMED', 'SUBMITTED'] } },
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
  notifyBountyClaimed(bounty.createdBy, userId, bountyId, bounty.description, bounty.crewId).catch(() => {})

  return { ...bounty, claimedBy: userId, status: 'CLAIMED' as const }
}

/**
 * Give up a claimed bounty (returns to OPEN status). Allowed from CLAIMED and
 * from SUBMITTED; any submission and review feedback is cleared.
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

  if (bounty.status !== 'CLAIMED' && bounty.status !== 'SUBMITTED') {
    throw new ConflictError('Bounty is not in claimed status')
  }

  const released = await prisma.bounty.updateMany({
    where: { id: bountyId, status: { in: ['CLAIMED', 'SUBMITTED'] }, claimedBy: userId },
    data: {
      claimedBy: null,
      status: 'OPEN',
      submissionNote: null,
      submissionLink: null,
      submittedAt: null,
      reviewNote: null,
    }
  })
  if (released.count !== 1) {
    throw new ConflictError('Bounty is not in claimed status')
  }

  return { ...bounty, claimedBy: null, status: 'OPEN' as const }
}

const MAX_SUBMISSION_NOTE = 2000
const MAX_REVIEW_NOTE = 2000

/** An https URL, or throws. Returns the normalized string. */
function validateHttpsLink(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ValidationError('Link must be a valid https URL')
  }
  if (url.protocol !== 'https:') {
    throw new ValidationError('Link must be a valid https URL')
  }
  return url.toString()
}

/**
 * Claimer submits their work for review (CLAIMED -> SUBMITTED). Also what a
 * resubmit after a rejection is: a rejection moves the bounty back to CLAIMED.
 *
 * The transition is a conditional update, so a racing give-up / cancel /
 * approve makes this fail with a ConflictError instead of resurrecting a
 * bounty. No money moves.
 */
export async function submitBounty(userId: string, bountyId: number, note: string, link?: string | null) {
  const trimmedNote = typeof note === 'string' ? note.trim() : ''
  if (!trimmedNote) {
    throw new ValidationError('A note about your work is required')
  }
  if (trimmedNote.length > MAX_SUBMISSION_NOTE) {
    throw new ValidationError(`Note must be at most ${MAX_SUBMISSION_NOTE} characters`)
  }
  const trimmedLink = typeof link === 'string' ? link.trim() : ''
  const safeLink = trimmedLink ? validateHttpsLink(trimmedLink) : null

  const bounty = await prisma.bounty.findUnique({
    where: { id: bountyId }
  })

  if (!bounty) {
    throw new NotFoundError('Bounty')
  }

  if (bounty.claimedBy !== userId) {
    throw new ForbiddenError('Only the claimer can submit work for this bounty')
  }

  if (bounty.status !== 'CLAIMED') {
    throw new ConflictError('Bounty is not in claimed status')
  }

  const submitted = await prisma.bounty.updateMany({
    where: { id: bountyId, status: 'CLAIMED', claimedBy: userId },
    data: {
      status: 'SUBMITTED',
      submissionNote: trimmedNote,
      submissionLink: safeLink,
      submittedAt: new Date(),
      reviewNote: null,
    }
  })
  if (submitted.count !== 1) {
    throw new ConflictError('Bounty is not in claimed status')
  }

  // Notify the poster and crew leads (fire and forget)
  notifyBountySubmitted(bounty.createdBy, userId, bountyId, bounty.description, bounty.crewId).catch(() => {})

  return { ...bounty, status: 'SUBMITTED' as const, submissionNote: trimmedNote, submissionLink: safeLink }
}

/**
 * Send a submission back to the claimer with feedback (SUBMITTED -> CLAIMED).
 * Poster, a lead of the bounty's crew, or an admin. No money moves.
 */
export async function rejectBounty(reviewerId: string, bountyId: number, note: string) {
  const trimmedNote = typeof note === 'string' ? note.trim() : ''
  if (!trimmedNote) {
    throw new ValidationError('A note explaining the rejection is required')
  }
  if (trimmedNote.length > MAX_REVIEW_NOTE) {
    throw new ValidationError(`Note must be at most ${MAX_REVIEW_NOTE} characters`)
  }

  const bounty = await prisma.bounty.findUnique({
    where: { id: bountyId }
  })

  if (!bounty) {
    throw new NotFoundError('Bounty')
  }

  if (!(await canManageBounty(reviewerId, bounty))) {
    throw new ForbiddenError('Only the bounty poster or a crew lead can reject a submission')
  }

  if (bounty.status !== 'SUBMITTED' || !bounty.claimedBy) {
    throw new ConflictError('Bounty has no submission to reject')
  }
  const claimerId = bounty.claimedBy

  const rejected = await prisma.bounty.updateMany({
    where: { id: bountyId, status: 'SUBMITTED', claimedBy: claimerId },
    data: { status: 'CLAIMED', reviewNote: trimmedNote, reviewedBy: reviewerId }
  })
  if (rejected.count !== 1) {
    throw new ConflictError('Bounty has no submission to reject')
  }

  notifyBountyRejected(claimerId, reviewerId, bountyId, bounty.description, trimmedNote, bounty.crewId).catch(() => {})

  return { ...bounty, status: 'CLAIMED' as const, reviewNote: trimmedNote, reviewedBy: reviewerId }
}

/**
 * Complete a bounty (approve: the escrowed reward is paid to the claimer).
 *
 * Who: the poster, a lead of the bounty's crew, or an admin. NEVER the
 * claimer, even if they are a lead or admin (no self-approval).
 *
 * The CLAIMED/SUBMITTED -> COMPLETED transition is a conditional update in the
 * same DB transaction as the payout and its ledger row, so the escrow is
 * released exactly once even if poster and lead both click Approve, the call is
 * double-submitted, or it races a reject / cancel / give-up.
 */
export async function completeBounty(approverId: string, bountyId: number) {
  const bounty = await prisma.bounty.findUnique({
    where: { id: bountyId }
  })

  if (!bounty) {
    throw new NotFoundError('Bounty')
  }

  if (bounty.claimedBy && bounty.claimedBy === approverId) {
    throw new ForbiddenError('You cannot approve your own work')
  }

  if (!(await canManageBounty(approverId, bounty))) {
    throw new ForbiddenError('Only the bounty poster or a crew lead can complete it')
  }

  if (bounty.status !== 'CLAIMED' && bounty.status !== 'SUBMITTED') {
    throw new ConflictError('Bounty must be claimed before completion')
  }

  if (!bounty.claimedBy) {
    throw new ConflictError('No one has claimed this bounty')
  }
  const claimerId = bounty.claimedBy

  await getOrCreateEconomy(claimerId)

  const plainDescription = await plainMemoDescription(bounty.description)

  await prisma.$transaction(async (tx) => {
    const done = await tx.bounty.updateMany({
      where: { id: bountyId, status: { in: ['CLAIMED', 'SUBMITTED'] }, claimedBy: claimerId },
      data: { status: 'COMPLETED', reviewedBy: approverId, completedAt: new Date() }
    })
    if (done.count !== 1) {
      throw new ConflictError('Bounty is no longer awaiting completion')
    }
    await creditInTx(tx, claimerId, bounty.reward, 'BOUNTY_REWARD', `Bounty reward: ${plainDescription}`, {
      bountyId,
      approvedBy: approverId,
    })
  })

  // Notify the claimer (and the poster if someone else approved); fire and forget
  notifyBountyCompleted(
    claimerId, approverId, bountyId, bounty.description, bounty.reward, bounty.crewId, bounty.createdBy
  ).catch(() => {})

  return { ...bounty, status: 'COMPLETED' as const }
}

/**
 * Cancel a bounty (escrowed reward refunded).
 *
 * Who: the poster, a lead of the bounty's crew, or an admin. The refund ALWAYS
 * goes to the poster (bounty.createdBy), never to the actor.
 *
 * Same pattern as completeBounty: the status transition, the refund and its
 * ledger row commit together, and only one of any concurrent complete/cancel
 * calls can win. Allowed from OPEN, CLAIMED and SUBMITTED.
 */
export async function cancelBounty(actorId: string, bountyId: number) {
  const bounty = await prisma.bounty.findUnique({
    where: { id: bountyId }
  })

  if (!bounty) {
    throw new NotFoundError('Bounty')
  }

  if (!(await canManageBounty(actorId, bounty))) {
    throw new ForbiddenError('Only the bounty poster or a crew lead can cancel it')
  }

  if (bounty.status === 'COMPLETED') {
    throw new ConflictError('Cannot cancel a completed bounty')
  }

  if (bounty.status === 'CANCELLED') {
    throw new ConflictError('Bounty is already cancelled')
  }

  const posterId = bounty.createdBy
  await getOrCreateEconomy(posterId)

  const plainDescription = await plainMemoDescription(bounty.description)

  await prisma.$transaction(async (tx) => {
    const cancelled = await tx.bounty.updateMany({
      where: { id: bountyId, status: { in: ['OPEN', 'CLAIMED', 'SUBMITTED'] } },
      data: { status: 'CANCELLED', reviewedBy: actorId }
    })
    if (cancelled.count !== 1) {
      throw new ConflictError('Bounty can no longer be cancelled')
    }
    await creditInTx(tx, posterId, bounty.reward, 'BOUNTY_REFUND', `Bounty refund: ${plainDescription}`, {
      bountyId,
      cancelledBy: actorId,
    })
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
      status: { in: ['OPEN', 'CLAIMED', 'SUBMITTED'] },
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
 * Add a comment to a bounty (creator, claimer, a lead of its crew, or an admin)
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

  // Only the claimer, the poster, or a crew lead / admin can comment
  if (bounty.claimedBy !== userId && !(await canManageBounty(userId, bounty))) {
    throw new ForbiddenError('Only the bounty creator, claimer or a crew lead can post comments')
  }

  const comment = await prisma.bountyComment.create({
    data: {
      bountyId,
      authorId: userId,
      content: content.trim()
    }
  })

  // Send notifications to all involved parties (fire and forget)
  notifyBountyComment(userId, bountyId, bounty.description, bounty.createdBy, bounty.claimedBy, bounty.crewId).catch(() => {})

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
