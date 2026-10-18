import { prisma } from './db'
import { NotificationType, Prisma } from '@prisma/client'
import { getCrewLeadMemberIds } from './crew-leads'
import { fetchMemberById } from './sheets/member-repository'

export { NotificationType }

export type CreateNotificationInput = {
  type: NotificationType
  recipientId: string
  actorId?: string
  title: string
  message: string
  metadata?: Prisma.InputJsonValue
  linkUrl?: string
}

/**
 * Create a new notification
 */
export async function createNotification(input: CreateNotificationInput) {
  return prisma.notification.create({
    data: {
      type: input.type,
      recipientId: input.recipientId,
      actorId: input.actorId,
      title: input.title,
      message: input.message,
      metadata: input.metadata,
      linkUrl: input.linkUrl
    }
  })
}

/**
 * Get notifications for a user (most recent first)
 */
export async function getNotifications(userId: string, limit = 20) {
  return prisma.notification.findMany({
    where: { recipientId: userId },
    orderBy: { createdAt: 'desc' },
    take: limit
  })
}

/**
 * Get unread notification count for a user
 */
export async function getUnreadCount(userId: string) {
  return prisma.notification.count({
    where: {
      recipientId: userId,
      readAt: null
    }
  })
}

/**
 * Mark a single notification as read
 */
export async function markAsRead(notificationId: string, userId: string) {
  return prisma.notification.updateMany({
    where: {
      id: notificationId,
      recipientId: userId, // Ensure user owns this notification
      readAt: null
    },
    data: {
      readAt: new Date()
    }
  })
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllAsRead(userId: string) {
  return prisma.notification.updateMany({
    where: {
      recipientId: userId,
      readAt: null
    },
    data: {
      readAt: new Date()
    }
  })
}

// ===== NOTIFICATION HELPERS =====

/** Where a bounty notification should land: the crew's bounty board, or /pep. */
function bountyLink(crewId?: string | null): string {
  return crewId ? `/crew/${encodeURIComponent(crewId)}#bounties` : '/pep'
}

/**
 * Notify bounty poster when someone claims their bounty
 */
export async function notifyBountyClaimed(
  posterId: string,
  claimerId: string,
  bountyId: number,
  bountyDescription: string,
  crewId?: string | null
) {
  // Don't notify yourself
  if (posterId === claimerId) return null

  return createNotification({
    type: NotificationType.BOUNTY_CLAIMED,
    recipientId: posterId,
    actorId: claimerId,
    title: 'Bounty Claimed',
    message: `Someone claimed your bounty: "${truncate(bountyDescription, 50)}"`,
    metadata: { bountyId },
    linkUrl: bountyLink(crewId)
  })
}

/**
 * Notify claimer when bounty is completed and reward paid. When a crew lead /
 * admin approved someone else's bounty (approver !== poster), the poster is
 * told too.
 */
export async function notifyBountyCompleted(
  claimerId: string,
  approverId: string,
  bountyId: number,
  bountyDescription: string,
  reward: number,
  crewId?: string | null,
  posterId?: string
) {
  const linkUrl = bountyLink(crewId)
  const jobs: Promise<unknown>[] = []

  // Don't notify yourself
  if (claimerId !== approverId) {
    jobs.push(createNotification({
      type: NotificationType.BOUNTY_COMPLETED,
      recipientId: claimerId,
      actorId: approverId,
      title: 'Bounty Approved!',
      message: `Your work on "${truncate(bountyDescription, 50)}" was approved. You earned ${reward} $PEP!`,
      metadata: { bountyId, reward },
      linkUrl
    }))
  }
  if (posterId && posterId !== approverId && posterId !== claimerId) {
    jobs.push(createNotification({
      type: NotificationType.BOUNTY_COMPLETED,
      recipientId: posterId,
      actorId: approverId,
      title: 'Bounty Approved',
      message: `Your bounty "${truncate(bountyDescription, 50)}" was approved and ${reward} $PEP went to the claimer.`,
      metadata: { bountyId, reward },
      linkUrl
    }))
  }
  if (jobs.length === 0) return null
  return Promise.allSettled(jobs)
}

/**
 * Notify the poster (and, best effort, the crew's leads) that work was submitted.
 */
export async function notifyBountySubmitted(
  posterId: string,
  claimerId: string,
  bountyId: number,
  bountyDescription: string,
  crewId?: string | null
) {
  const recipients = new Set<string>([posterId])

  if (crewId) {
    // Best effort: lead lookup failing must never block the submission.
    try {
      const leadMemberIds = await getCrewLeadMemberIds(crewId)
      const rows = await Promise.all(
        Array.from(leadMemberIds).map((id) => fetchMemberById(id).catch(() => null))
      )
      for (const row of rows) {
        if (row?.discordId) recipients.add(String(row.discordId))
      }
    } catch {
      // swallow
    }
  }
  recipients.delete(claimerId)

  const linkUrl = bountyLink(crewId)
  await Promise.allSettled(
    Array.from(recipients).map((recipientId) =>
      createNotification({
        type: NotificationType.BOUNTY_SUBMITTED,
        recipientId,
        actorId: claimerId,
        title: 'Bounty Work Submitted',
        message: `Work was submitted on: "${truncate(bountyDescription, 50)}"`,
        metadata: { bountyId },
        linkUrl
      })
    )
  )
}

/**
 * Notify the claimer that their submission was sent back with feedback.
 */
export async function notifyBountyRejected(
  claimerId: string,
  reviewerId: string,
  bountyId: number,
  bountyDescription: string,
  note: string,
  crewId?: string | null
) {
  if (claimerId === reviewerId) return null

  return createNotification({
    type: NotificationType.BOUNTY_REJECTED,
    recipientId: claimerId,
    actorId: reviewerId,
    title: 'Bounty Sent Back',
    message: `Your submission on "${truncate(bountyDescription, 50)}" was sent back: ${truncate(note, 100)}`,
    metadata: { bountyId },
    linkUrl: bountyLink(crewId)
  })
}

/**
 * Notify all involved parties when a new comment is posted on a bounty.
 * Recipients: bounty poster, bounty claimer, and all previous commenters.
 * Excludes the person who just posted the comment.
 */
export async function notifyBountyComment(
  commenterId: string,
  bountyId: number,
  bountyDescription: string,
  posterId: string,
  claimerId: string | null,
  crewId?: string | null
) {
  // Gather all unique commenter IDs from existing comments on this bounty
  const existingComments = await prisma.bountyComment.findMany({
    where: { bountyId },
    select: { authorId: true },
    distinct: ['authorId']
  })

  // Build a set of all recipients: poster + claimer + existing commenters
  const recipientSet = new Set<string>()
  recipientSet.add(posterId)
  if (claimerId) recipientSet.add(claimerId)
  for (const c of existingComments) {
    recipientSet.add(c.authorId)
  }

  // Remove the commenter themselves (don't notify yourself)
  recipientSet.delete(commenterId)

  if (recipientSet.size === 0) return

  // Create notifications for all recipients
  const notifications = Array.from(recipientSet).map(recipientId =>
    createNotification({
      type: NotificationType.BOUNTY_COMMENT,
      recipientId,
      actorId: commenterId,
      title: 'New Bounty Comment',
      message: `New comment on bounty: "${truncate(bountyDescription, 50)}"`,
      metadata: { bountyId },
      linkUrl: bountyLink(crewId)
    })
  )

  await Promise.allSettled(notifications)
}

/**
 * Truncate a string with ellipsis
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - 3) + '...'
}
