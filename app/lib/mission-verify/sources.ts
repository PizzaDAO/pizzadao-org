/**
 * The real data sources behind the verifiers (see VerifierSources). Tests
 * inject their own; nothing here is called from a unit test.
 */
import { prisma } from '../db'
import { lookupGuildMembership } from '../discord'
import { getChannel, getChannelMessage, resolveChannelId } from '../discord-channels'
import { getGuildRoles } from '../discord-interactions/guild-roles'
import type { VerifierSources } from './types'

export const defaultSources: VerifierSources = {
  async getXAccount(discordId) {
    const x = await prisma.xAccount.findUnique({ where: { discordId }, select: { xUsername: true } })
    return x ? { xUsername: x.xUsername } : null
  },

  async countCallsAttended(discordId) {
    // One CallAttendance row per person per call (@@unique([discordId, dailySheetId])),
    // synced from the community and crew attendance sheets (app/lib/attendance.ts).
    const rows = await prisma.callAttendance.groupBy({
      by: ['crewId'],
      where: { discordId },
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
    return prisma.memberWallet.count({
      where: memberId ? { OR: [{ memberId }, { discordId }] } : { discordId },
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
}
