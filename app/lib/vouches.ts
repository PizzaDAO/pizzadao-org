import { prisma } from './db'
import { VouchSource } from '@prisma/client'
import { createNotification, NotificationType } from './notifications'
import { fetchMemberById } from './sheets/member-repository'

export { VouchSource }

/**
 * Add a vouch. Creates a one-way vouch relationship.
 */
export async function addVouch(
  followerId: string,
  followeeId: string,
  source: VouchSource = VouchSource.PIZZADAO
) {
  if (followerId === followeeId) {
    throw new Error('Cannot vouch for yourself')
  }

  return prisma.vouch.create({
    data: {
      followerId,
      followeeId,
      source
    }
  })
}

/**
 * Remove a vouch. Deletes the one-way vouch relationship.
 */
export async function removeVouch(followerId: string, followeeId: string) {
  return prisma.vouch.deleteMany({
    where: { followerId, followeeId }
  })
}

/**
 * Get vouches (people the member has vouched for) with enriched data from Google Sheets.
 */
export async function getVouches(
  memberId: string,
  limit = 50,
  source?: VouchSource
) {
  const where: any = { followerId: memberId }
  if (source) where.source = source

  const vouches = await prisma.vouch.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit
  })

  // Enrich with member data from Google Sheets
  const enriched = await Promise.all(
    vouches.map(async (v) => {
      try {
        const member = await fetchMemberById(v.followeeId)
        return {
          memberId: v.followeeId,
          name: member?.['Name'] || member?.['Mafia Name'] || 'Unknown',
          city: member?.['City'] || '',
          crews: member?.['Crews'] || '',
          source: v.source,
          createdAt: v.createdAt
        }
      } catch {
        return {
          memberId: v.followeeId,
          name: 'Unknown',
          city: '',
          crews: '',
          source: v.source,
          createdAt: v.createdAt
        }
      }
    })
  )

  return enriched
}

/**
 * Get vouch counts by source
 */
export async function getVouchCounts(memberId: string) {
  const [total, pizzadao, farcaster, twitter, followers] = await Promise.all([
    prisma.vouch.count({ where: { followerId: memberId } }),
    prisma.vouch.count({
      where: { followerId: memberId, source: VouchSource.PIZZADAO }
    }),
    prisma.vouch.count({
      where: { followerId: memberId, source: VouchSource.FARCASTER }
    }),
    prisma.vouch.count({
      where: { followerId: memberId, source: VouchSource.TWITTER }
    }),
    prisma.vouch.count({ where: { followeeId: memberId } })
  ])

  return { total, pizzadao, farcaster, twitter, followers }
}

/**
 * Check if a member has vouched for another member
 */
export async function isVouched(
  followerId: string,
  followeeId: string
): Promise<boolean> {
  const count = await prisma.vouch.count({
    where: { followerId, followeeId }
  })
  return count > 0
}

/**
 * Get mutual vouches between two members
 */
export async function getMutualVouches(
  memberIdA: string,
  memberIdB: string
): Promise<string[]> {
  // Vouches of A
  const vouchesOfA = await prisma.vouch.findMany({
    where: { followerId: memberIdA },
    select: { followeeId: true }
  })
  const aFollowees = new Set(vouchesOfA.map((v) => v.followeeId))

  // Vouches of B
  const vouchesOfB = await prisma.vouch.findMany({
    where: { followerId: memberIdB },
    select: { followeeId: true }
  })
  const bFollowees = new Set(vouchesOfB.map((v) => v.followeeId))

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
export async function notifyVouchAdded(
  targetMemberId: string,
  voucherName: string,
  voucherMemberId: string,
  targetDiscordId: string
) {
  return createNotification({
    type: NotificationType.VOUCH_ADDED,
    recipientId: targetDiscordId,
    title: 'New Vouch',
    message: `${voucherName} vouched for you`,
    metadata: { voucherMemberId },
    linkUrl: `/profile/${voucherMemberId}`
  })
}
