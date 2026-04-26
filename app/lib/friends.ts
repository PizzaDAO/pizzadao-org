import { prisma } from './db'
import { FriendSource } from '@prisma/client'
import { createNotification, NotificationType } from './notifications'
import { fetchMemberById } from './sheets/member-repository'

export { FriendSource }

/**
 * Add a friend (vouch). Creates a one-way vouch relationship.
 */
export async function addFriend(
  voucherId: string,
  vouchedId: string,
  source: FriendSource = FriendSource.PIZZADAO
) {
  if (voucherId === vouchedId) {
    throw new Error('Cannot vouch for yourself')
  }

  return prisma.friendship.create({
    data: {
      voucherId,
      vouchedId,
      source
    }
  })
}

/**
 * Remove a friend (remove vouch). Deletes the one-way vouch relationship.
 */
export async function removeFriend(voucherId: string, vouchedId: string) {
  return prisma.friendship.deleteMany({
    where: { voucherId, vouchedId }
  })
}

/**
 * Get friends (people the member is vouching for) with enriched data from Google Sheets.
 */
export async function getFriends(
  memberId: string,
  limit = 50,
  source?: FriendSource
) {
  const where: any = { voucherId: memberId }
  if (source) where.source = source

  const friendships = await prisma.friendship.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit
  })

  // Enrich with member data from Google Sheets
  const friends = await Promise.all(
    friendships.map(async (f) => {
      try {
        const member = await fetchMemberById(f.vouchedId)
        return {
          memberId: f.vouchedId,
          name: member?.['Name'] || member?.['Mafia Name'] || 'Unknown',
          city: member?.['City'] || '',
          crews: member?.['Crews'] || '',
          source: f.source,
          createdAt: f.createdAt
        }
      } catch {
        return {
          memberId: f.vouchedId,
          name: 'Unknown',
          city: '',
          crews: '',
          source: f.source,
          createdAt: f.createdAt
        }
      }
    })
  )

  return friends
}

/**
 * Get friend counts by source
 */
export async function getFriendCounts(memberId: string) {
  const [total, pizzadao, farcaster, twitter, followers] = await Promise.all([
    prisma.friendship.count({ where: { voucherId: memberId } }),
    prisma.friendship.count({
      where: { voucherId: memberId, source: FriendSource.PIZZADAO }
    }),
    prisma.friendship.count({
      where: { voucherId: memberId, source: FriendSource.FARCASTER }
    }),
    prisma.friendship.count({
      where: { voucherId: memberId, source: FriendSource.TWITTER }
    }),
    prisma.friendship.count({ where: { vouchedId: memberId } })
  ])

  return { total, pizzadao, farcaster, twitter, followers }
}

/**
 * Check if a member has vouched for another member
 */
export async function isFriend(
  voucherId: string,
  vouchedId: string
): Promise<boolean> {
  const count = await prisma.friendship.count({
    where: { voucherId, vouchedId }
  })
  return count > 0
}

/**
 * Get mutual friends between two members
 */
export async function getMutualFriends(
  memberIdA: string,
  memberIdB: string
): Promise<string[]> {
  // Friends of A
  const friendsOfA = await prisma.friendship.findMany({
    where: { voucherId: memberIdA },
    select: { vouchedId: true }
  })
  const aVouched = new Set(friendsOfA.map((f) => f.vouchedId))

  // Friends of B
  const friendsOfB = await prisma.friendship.findMany({
    where: { voucherId: memberIdB },
    select: { vouchedId: true }
  })
  const bVouched = new Set(friendsOfB.map((f) => f.vouchedId))

  // Intersection
  const mutual: string[] = []
  for (const id of aVouched) {
    if (bVouched.has(id)) {
      mutual.push(id)
    }
  }

  return mutual
}

/**
 * Notify a member that someone vouched for them
 */
export async function notifyFriendAdded(
  targetMemberId: string,
  followerName: string,
  followerMemberId: string,
  targetDiscordId: string
) {
  return createNotification({
    type: NotificationType.FRIEND_ADDED,
    recipientId: targetDiscordId,
    title: 'New Vouch',
    message: `${followerName} vouched for you`,
    metadata: { followerMemberId },
    linkUrl: `/profile/${followerMemberId}`
  })
}
