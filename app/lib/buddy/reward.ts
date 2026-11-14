/**
 * Buddy reward hook: when a pair completes, mark the configured bonus mission done for the buddy,
 * so the normal bonus-mission payout runs (once per member and mission). Behind buddy.rewardEnabled;
 * while it is off only a "would have rewarded" row is written to the pair history.
 */
import { prisma } from '@/app/lib/db'
import { loadSettings } from '@/app/lib/settings'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { payBonusRewards } from '@/app/lib/missions'

export type RewardOutcome = 'dry_run' | 'no_mission' | 'mission_unusable' | 'already_done' | 'granted'

export async function rewardBuddy(pair: { pairId: string; buddyDiscordId: string }): Promise<RewardOutcome> {
  const missionId = (await loadSettings()).get('buddy.rewardMissionId')
  const log = (kind: string, data: Record<string, unknown>) =>
    prisma.buddyEvent.create({ data: { pairId: pair.pairId, kind, actor: 'system', data: data as object } })

  if (!(await toggleEnabled('buddy.rewardEnabled'))) {
    await log('reward_dry_run', { missionId })
    return 'dry_run'
  }
  if (!missionId) {
    await log('reward_skipped', { reason: 'no_mission_configured' })
    return 'no_mission'
  }
  const mission = await prisma.mission.findUnique({ where: { id: missionId }, select: { id: true, isActive: true, bonus: true } })
  if (!mission || !mission.isActive || !mission.bonus) {
    await log('reward_skipped', { reason: 'mission_not_an_active_bonus', missionId })
    return 'mission_unusable'
  }
  const existing = await prisma.missionCompletion.findUnique({
    where: { missionId_discordId: { missionId, discordId: pair.buddyDiscordId } },
    select: { status: true },
  })
  if (existing?.status === 'APPROVED') {
    await log('reward_skipped', { reason: 'already_done', missionId })
    return 'already_done'
  }
  const now = new Date()
  const approved = {
    status: 'APPROVED' as const,
    source: 'AUTO' as const,
    reviewedBy: 'buddy-system',
    reviewedAt: now,
    reviewNote: 'Buddy completed',
    holdReason: null,
  }
  await prisma.missionCompletion.upsert({
    where: { missionId_discordId: { missionId, discordId: pair.buddyDiscordId } },
    create: { missionId, discordId: pair.buddyDiscordId, ...approved },
    update: approved,
  })
  await payBonusRewards(pair.buddyDiscordId)
  await log('reward_granted', { missionId })
  return 'granted'
}
