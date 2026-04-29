import { prisma } from './db'
import { SocialPlatform } from '@prisma/client'

export { SocialPlatform }

/**
 * Link (upsert) a social account for a member
 */
export async function linkSocialAccount(
  memberId: string,
  platform: SocialPlatform,
  handle: string
) {
  return prisma.socialAccount.upsert({
    where: {
      memberId_platform: { memberId, platform }
    },
    update: {
      handle: handle.trim(),
      updatedAt: new Date()
    },
    create: {
      memberId,
      platform,
      handle: handle.trim()
    }
  })
}

/**
 * Get all social accounts for a member
 */
export async function getSocialAccounts(memberId: string) {
  return prisma.socialAccount.findMany({
    where: { memberId },
    select: {
      platform: true,
      handle: true,
      verified: true
    }
  })
}

/**
 * Unlink (delete) a social account for a member
 */
export async function unlinkSocialAccount(
  memberId: string,
  platform: SocialPlatform
) {
  return prisma.socialAccount.deleteMany({
    where: { memberId, platform }
  })
}
