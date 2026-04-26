import { prisma } from './db'
import { FriendSource } from '@prisma/client'
import { createNotification, NotificationType } from './notifications'
import { fetchMemberById } from './sheets/member-repository'

export { FriendSource }

/**
 * Add a friend (vouch). Creates a one-way vouch relationship.
 */
export async function addFriend(
  followerId: string,
  followeeId: string,
  source: FriendSource = FriendSource.PIZZADAO
) {
  if (followerId === followeeId) {
    throw new Error('Cannot vouch for yourself')
  }

  return prisma.friendship.create({
    data: {
      followerId,
      followeeId,
      source
    }
  })
}

/**
 * Remove a friend (remove vouch). Deletes the one-way vouch relationship.
 */
export async function removeFriend(followerId: string, followeeId: string) {
  return prisma.friendship.deleteMany({
    where: { followerId, followeeId }
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
  const where: any = { followerId: memberId }
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
        const member = await fetchMemberById(f.followeeId)
        return {
          memberId: f.followeeId,
          name: member?.['Name'] || member?.['Mafia Name'] || 'Unknown',
          city: member?.['City'] || '',
          crews: member?.['Crews'] || '',
          source: f.source,
          createdAt: f.createdAt
        }
      } catch {
        return {
          memberId: f.followeeId,
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
    prisma.friendship.count({ where: { followerId: memberId } }),
    prisma.friendship.count({
      where: { followerId: memberId, source: FriendSource.PIZZADAO }
    }),
    prisma.friendship.count({
      where: { followerId: memberId, source: FriendSource.FARCASTER }
    }),
    prisma.friendship.count({
      where: { followerId: memberId, source: FriendSource.TWITTER }
    }),
    prisma.friendship.count({ where: { followeeId: memberId } })
  ])

  return { total, pizzadao, farcaster, twitter, followers }
}

/**
 * Check if a member has vouched for another member
 */
export async function isFriend(
  followerId: string,
  followeeId: string
): Promise<boolean> {
  const count = await prisma.friendship.count({
    where: { followerId, followeeId }
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
    where: { followerId: memberIdA },
    select: { followeeId: true }
  })
  const aFollowees = new Set(friendsOfA.map((f) => f.followeeId))

  // Friends of B
  const friendsOfB = await prisma.friendship.findMany({
    where: { followerId: memberIdB },
    select: { followeeId: true }
  })
  const bFollowees = new Set(friendsOfB.map((f) => f.followeeId))

  // Intersection
  const mutual: string[] = []
  for (const id of aFollowees) {
    if (bFollowees.has(id)) {
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
