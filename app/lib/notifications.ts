import { prisma } from './db'
import { NotificationType, Prisma } from '@prisma/client'

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

/**
 * Notify bounty poster when someone claims their bounty
 */
export async function notifyBountyClaimed(
  posterId: string,
  claimerId: string,
  bountyId: number,
  bountyDescription: string
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
    linkUrl: '/pep'
  })
}

/**
 * Notify claimer when bounty is completed and reward paid
 */
export async function notifyBountyCompleted(
  claimerId: string,
  posterId: string,
  bountyId: number,
  bountyDescription: string,
  reward: number
) {
  // Don't notify yourself
  if (claimerId === posterId) return null

  return createNotification({
    type: NotificationType.BOUNTY_COMPLETED,
    recipientId: claimerId,
    actorId: posterId,
    title: 'Bounty Approved!',
    message: `Your work on "${truncate(bountyDescription, 50)}" was approved. You earned ${reward} $PEP!`,
    metadata: { bountyId, reward },
    linkUrl: '/pep'
  })
}

/**
 * Truncate a string with ellipsis
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength - 3) + '...'
}
