/**
 * The real data sources behind the verifiers (see VerifierSources). Tests
 * inject their own; nothing here is called from a unit test.
 */
import { prisma } from '../db'
import { lookupGuildMembership } from '../discord'
import { getChannel, getChannelMessage, resolveChannelId } from '../discord-channels'
import { getGuildRoles } from '../discord-interactions/guild-roles'
import { canManageCrew } from '../crew-leads'
import { isDreadPizzaRoberts } from '../mission-review-access'
import { getCurrentLevel, getPaidLevels } from '../missions'
import { checkRarePizzaBox } from '../rare-pizza-box'
import { toggleEnabled } from '../settings/toggles'
import type { CrewTaskDoneRow, VerifierSources } from './types'

export const defaultSources: VerifierSources = {
  async getXAccount(discordId) {
    const x = await prisma.xAccount.findUnique({ where: { discordId }, select: { xUsername: true } })
    return x ? { xUsername: x.xUsername } : null
  },

  async countCallsAttended(discordId, opts) {
    // One CallAttendance row per person per call (@@unique([discordId, dailySheetId])),
    // synced from the community and crew attendance sheets (app/lib/attendance.ts).
    const rows = await prisma.callAttendance.groupBy({
      by: ['crewId'],
      where: {
        discordId,
        ...(opts?.crewId ? { crewId: opts.crewId } : {}),
        ...(opts?.sinceDays ? { callDate: { gte: new Date((opts.now ?? new Date()).getTime() - opts.sinceDays * 86_400_000) } } : {}),
      },
      _count: { _all: true },
    })
    const byCrew: Record<string, number> = {}
    let total = 0
    for (const r of rows) {
      byCrew[r.crewId] = r._count._all
      total += r._count._all
    }
    return { total, calls: total, byCrew }
  },

  async countActivity(kind, discordId, memberId) {
    switch (kind) {
      case 'pizzeria_checkin':
        return prisma.pizzeriaCheckIn.count({ where: { discordId, status: 'APPROVED' } })
      case 'passport_stamp':
        return prisma.passportStamp.count({ where: { discordId } })
      case 'spotlight_featured':
        return prisma.spotlightSubmission.count({
          where: { status: 'FEATURED', OR: [{ nomineeDiscordId: discordId }, { submitterDiscordId: discordId, isSelf: true }] },
        })
      case 'shop_purchase':
        return prisma.transaction.count({ where: { userId: discordId, type: 'SHOP_PURCHASE' } })
      case 'bounty_completed':
        return prisma.bounty.count({ where: { claimedBy: discordId, status: 'COMPLETED' } })
      case 'job_completed':
        return prisma.transaction.count({ where: { userId: discordId, type: 'JOB_REWARD' } })
      case 'article_published':
        return prisma.article.count({ where: { authorId: discordId, status: 'PUBLISHED' } })
      case 'buddy_completed':
        return prisma.buddyPair.count({ where: { buddyDiscordId: discordId, status: 'COMPLETED' } })
    }
  },

  async getDoneCrewTasksLedBy(memberId) {
    return doneCrewTasksLedBy(memberId)
  },

  async canCloseCrewTasks(discordId, crewId) {
    // Lead of the crew (roster), or an admin role; Dread Pizza Roberts is always allowed. Both fail closed.
    return (await canManageCrew(discordId, crewId)) || (await isDreadPizzaRoberts(discordId))
  },

  async getMemberRoles(discordId) {
    const m = await lookupGuildMembership(discordId)
    if (m.status === 'member') return m.member.roles ?? []
    if (m.status === 'not_member') return []
    return null
  },

  async resolveRoleIds(names) {
    const guildId = process.env.DISCORD_GUILD_ID?.trim()
    const roles = guildId ? await getGuildRoles(guildId) : null
    if (!roles) return null
    const want = new Set(names.map((n) => n.trim().toLowerCase()))
    return roles.filter((r) => want.has(r.name.trim().toLowerCase())).map((r) => r.id)
  },

  guildId: () => process.env.DISCORD_GUILD_ID?.trim() || null,

  resolveChannelId: (name, envName) => resolveChannelId(name, envName),

  async getChannelMessage(channelId, messageId) {
    const m = await getChannelMessage(channelId, messageId)
    return m === 'unknown' || m === null ? m : { channelId: m.channelId, authorId: m.authorId }
  },

  async getChannel(channelId) {
    const c = await getChannel(channelId)
    return c === 'unknown' || c === null ? c : { id: c.id, parentId: c.parentId }
  },

  async countWallets(discordId, memberId) {
    // With wallets.requireSignature on, only EVM wallets count (a pasted Solana address does not).
    const evmOnly = await toggleEnabled('wallets.requireSignature').catch(() => false)
    return prisma.memberWallet.count({
      where: { ...(memberId ? { OR: [{ memberId }, { discordId }] } : { discordId }), ...(evmOnly ? { chainType: 'evm' } : {}) },
    })
  },

  async getReferrals(inviterDiscordId) {
    return prisma.referral.findMany({
      where: { inviterDiscordId },
      select: { inviteeDiscordId: true, inviteeMemberId: true, via: true, createdAt: true, qualifiedAt: true, flags: true },
      orderBy: { createdAt: 'asc' },
      take: 50,
    })
  },

  async getVouchesGiven(memberId) {
    return prisma.vouch.findMany({
      where: { followerId: memberId },
      select: { followeeId: true, source: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 200,
    })
  },

  async getVouchesReceived(memberId, sources) {
    return prisma.vouch.findMany({
      where: { followeeId: memberId, ...(sources?.length ? { source: { in: sources as never[] } } : {}) },
      select: { followerId: true, source: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 200,
    })
  },

  getWorkingLevel: (discordId) => getCurrentLevel(discordId),

  getPaidLevels: (discordId) => getPaidLevels(discordId),

  holdsRarePizzaBox: (memberId) => checkRarePizzaBox(memberId),

  async sharedSignalKinds(a, b) {
    const rows = await prisma.accountSignal
      .findMany({ where: { discordIds: { hasEvery: [a, b] } }, select: { kind: true } })
      .catch(() => [] as Array<{ kind: string }>)
    return [...new Set(rows.map((r) => r.kind))]
  },

  async getFarcasterAccounts(memberId) {
    if (!memberId) return []
    const rows = await prisma.socialAccount.findMany({
      where: { memberId, platform: 'FARCASTER' },
      select: { handle: true, platformId: true },
    })
    return rows.map((r) => ({
      username: r.handle.replace(/^@/, '').toLowerCase(),
      fid: r.platformId && /^\d+$/.test(r.platformId) ? Number(r.platformId) : null,
    }))
  },

  async getTelegramUsername(discordId) {
    const t = await prisma.telegramAccount.findUnique({ where: { discordId }, select: { username: true } })
    return t?.username?.replace(/^@/, '') || null
  },

  fetch: (input, init) => fetch(input, init),

  neynarApiKey: () => process.env.NEYNAR_API_KEY?.trim() || null,

  rsvPizzaApiUrl: () => (process.env.RSV_PIZZA_API_URL?.trim() || 'https://api.rsv.pizza').replace(/\/$/, ''),

  rsvPizzaServiceKey: () => process.env.RSV_PIZZA_SERVICE_KEY?.trim() || null,

  async getWalletAddresses(discordId, memberId) {
    const evmOnly = await toggleEnabled('wallets.requireSignature').catch(() => false)
    const rows = await prisma.memberWallet.findMany({
      where: { ...(memberId ? { OR: [{ memberId }, { discordId }] } : { discordId }), ...(evmOnly ? { chainType: 'evm' } : {}) },
      select: { walletAddress: true },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      take: 10,
    })
    return [...new Set(rows.map((r) => r.walletAddress.trim()).filter(Boolean))]
  },
}

/** Stages that mean "Done" (not "skip": a skipped task was not completed). */
export function isDoneStage(stage: string | null | undefined): boolean {
  const s = (stage ?? '').trim().toLowerCase()
  return s === 'done' || s === 'complete' || s === 'completed'
}

/**
 * Done crew tasks the member leads, each with who moved it to Done: the latest `update` CrewTaskEvent
 * whose changes set the stage to a Done value (written by the crew-page editor, the call-task proposals
 * and the Discord task commands; the actor is a Discord id). No such event = unknown closer (null).
 */
export async function doneCrewTasksLedBy(memberId: string): Promise<CrewTaskDoneRow[]> {
  const tasks = await prisma.crewTask.findMany({
    where: { leadMemberId: memberId, archived: false },
    select: { id: true, crewId: true, label: true, stage: true },
    take: 500,
  })
  const done = tasks.filter((t) => isDoneStage(t.stage))
  if (done.length === 0) return []
  const events = await prisma.crewTaskEvent.findMany({
    where: { taskId: { in: done.map((t) => t.id) }, action: 'update' },
    select: { taskId: true, actor: true, data: true },
    orderBy: { id: 'desc' },
  })
  const closer = new Map<string, string>()
  for (const e of events) {
    if (closer.has(e.taskId)) continue
    const changes = (e.data as { changes?: { stage?: unknown } } | null)?.changes
    if (typeof changes?.stage === 'string' && isDoneStage(changes.stage)) closer.set(e.taskId, e.actor)
  }
  return done.map((t) => ({ taskId: t.id, crewId: t.crewId, label: t.label, closedBy: closer.get(t.id) ?? null }))
}
