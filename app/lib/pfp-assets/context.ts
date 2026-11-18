// PFP asset rules use the highest level COMPLETED (Lv. 0 until level 1 is done), the same number the
// level badge shows: a rule "level 3" means level 3 completed. Missions and payouts keep getCurrentLevel.
// Builds the unlock context for one member by reusing the existing level computation, Discord
// role lookup and Inventory. The pure evaluator lives in unlocks.ts.
import { prisma } from '@/app/lib/db'
import { getCurrentLevel } from '@/app/lib/missions'
import { completedLevel } from '@/app/lib/level-display'
import { getUserRoles } from '@/app/lib/discord'
import type { UnlockContext } from './unlocks'

export async function loadUnlockContext(discordId: string): Promise<UnlockContext> {
  const [level, roleIds, completions, inventory, grants] = await Promise.all([
    getCurrentLevel(discordId).then(completedLevel).catch(() => 0),
    getUserRoles(discordId).catch(() => [] as string[]), // fail closed: no roles, no role assets
    prisma.missionCompletion.findMany({ where: { discordId, status: 'APPROVED' }, select: { missionId: true } }),
    prisma.inventory.findMany({ where: { userId: discordId, quantity: { gt: 0 } }, select: { itemId: true } }),
    prisma.pfpAssetGrant.findMany({ where: { discordId }, select: { assetId: true } }),
  ])
  return {
    level,
    roleIds: new Set(roleIds),
    approvedMissionIds: new Set(completions.map((c) => c.missionId)),
    itemIds: new Set(inventory.map((i) => i.itemId)),
    grantIds: new Set(grants.map((g) => g.assetId)),
  }
}
