/**
 * Read models for the buddy system: the member dashboard card (both sides of a pair, with the
 * checklist) and the admin page (pool, pairs, unmatched trainees).
 */
import { prisma } from '@/app/lib/db'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { completedLevelBy, getCurrentLevel } from '@/app/lib/missions'
import { readSignedUpMembers } from '@/app/lib/member-registration'
import { fetchMemberByDiscordId } from '@/app/lib/sheets/member-repository'
import { ACTIVE_PAIR_STATUSES, buildChecklist, isBuddyEligible, isActiveStatus, type ChecklistItem } from './rules'
import { buddySettings, completeIfDue } from './service'

const ACTIVE = [...ACTIVE_PAIR_STATUSES]
const RECENT_DONE_MS = 14 * 24 * 60 * 60 * 1000

export interface PairCard {
  id: string
  role: 'buddy' | 'trainee'
  status: string
  partner: { discordId: string; name: string }
  threadUrl: string | null
  checklist: ChecklistItem[]
}

export interface MyBuddyState {
  enabled: boolean
  eligible?: boolean
  minLevel?: number
  profile?: { active: boolean; paused: boolean; maxActive: number; languages: string[] } | null
  maxActiveCap?: number
  pairs?: PairCard[]
}

function threadUrl(threadId: string | null): string | null {
  const guild = process.env.DISCORD_GUILD_ID
  return threadId && guild ? `https://discord.com/channels/${guild}/${threadId}` : null
}

/** The facts the checklist ticks from: existing mission, attendance and vouch data. */
export async function loadChecklist(pair: {
  introducedAt: Date | null
  traineeDiscordId: string
  traineeMemberId: string | null
  buddyDiscordId: string
}, traineeLevel: number, completionLevel: number, buddyMemberId: string | null): Promise<ChecklistItem[]> {
  const [attendance, vouches] = await Promise.all([
    prisma.attendanceSummary.findUnique({ where: { discordId: pair.traineeDiscordId }, select: { totalCalls: true } }),
    pair.traineeMemberId && buddyMemberId
      ? prisma.vouch.count({ where: { followerId: buddyMemberId, followeeId: pair.traineeMemberId } })
      : Promise.resolve(0),
  ])
  return buildChecklist({
    introduced: !!pair.introducedAt,
    traineeLevel,
    completionLevel,
    traineeCalls: attendance?.totalCalls ?? 0,
    vouched: vouches > 0,
  })
}

export async function getMyBuddyState(discordId: string): Promise<MyBuddyState> {
  if (!(await toggleEnabled('buddy.enabled'))) return { enabled: false }
  const cfg = await buddySettings()
  const [level, profile, rows] = await Promise.all([
    getCurrentLevel(discordId),
    prisma.buddyProfile.findUnique({ where: { discordId } }),
    prisma.buddyPair.findMany({
      where: {
        OR: [{ buddyDiscordId: discordId }, { traineeDiscordId: discordId }],
        AND: [{ OR: [{ status: { in: ACTIVE } }, { status: 'COMPLETED', completedAt: { gte: new Date(Date.now() - RECENT_DONE_MS) } }] }],
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ])
  const pairs: PairCard[] = []
  for (const row of rows) {
    const role = row.buddyDiscordId === discordId ? 'buddy' : 'trainee'
    const traineeLevel = role === 'trainee' ? level : await getCurrentLevel(row.traineeDiscordId)
    let status = row.status
    if (isActiveStatus(status) && (await completeIfDue(row, traineeLevel, cfg.completionLevel))) status = 'COMPLETED'
    const partnerId = role === 'buddy' ? row.traineeDiscordId : row.buddyDiscordId
    const [partner, buddyProfile] = await Promise.all([
      fetchMemberByDiscordId(partnerId).catch(() => null),
      role === 'buddy' ? Promise.resolve(profile) : prisma.buddyProfile.findUnique({ where: { discordId: row.buddyDiscordId } }),
    ])
    pairs.push({
      id: row.id,
      role,
      status,
      partner: { discordId: partnerId, name: partner?.name || 'A member' },
      threadUrl: threadUrl(row.threadId),
      checklist: await loadChecklist(row, traineeLevel, cfg.completionLevel, buddyProfile?.memberId ?? null),
    })
  }
  return {
    enabled: true,
    eligible: isBuddyEligible(level, cfg.minLevel) || !!profile?.addedBy,
    minLevel: cfg.minLevel,
    maxActiveCap: cfg.cap,
    profile: profile ? { active: profile.active, paused: profile.paused, maxActive: profile.maxActive, languages: profile.languages } : null,
    pairs,
  }
}

export interface AdminBuddyOverview {
  enabled: boolean
  introThreadsEnabled: boolean
  rewardEnabled: boolean
  cap: number
  completionLevel: number
  buddies: Array<{ discordId: string; name: string; active: boolean; paused: boolean; maxActive: number; activeCount: number; capacity: number; addedBy: string | null }>
  trainees: Array<{ discordId: string; name: string }>
  traineesTruncated: boolean
  pairs: Array<{ id: string; status: string; trainee: { discordId: string; name: string }; buddy: { discordId: string; name: string }; threadId: string | null; createdAt: string; endedReason: string | null; lastEvent: string | null }>
}

const TRAINEE_LIMIT = 300
const PAIR_LIMIT = 100

export async function getAdminOverview(): Promise<AdminBuddyOverview> {
  const [enabled, introThreadsEnabled, rewardEnabled, cfg] = await Promise.all([
    toggleEnabled('buddy.enabled'),
    toggleEnabled('buddy.introThreadsEnabled'),
    toggleEnabled('buddy.rewardEnabled'),
    buddySettings(),
  ])
  const [names, profiles, pairs] = await Promise.all([
    readSignedUpMembers().catch(() => new Map<string, string>()),
    prisma.buddyProfile.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.buddyPair.findMany({ orderBy: { createdAt: 'desc' }, take: PAIR_LIMIT, include: { events: { orderBy: { at: 'desc' }, take: 1 } } }),
  ])
  const nameOf = (id: string) => names.get(id) || id
  const activeByBuddy = new Map<string, number>()
  const hasBuddy = new Set<string>()
  for (const p of pairs) {
    if (!isActiveStatus(p.status)) continue
    activeByBuddy.set(p.buddyDiscordId, (activeByBuddy.get(p.buddyDiscordId) ?? 0) + 1)
    hasBuddy.add(p.traineeDiscordId)
  }
  const ids = [...names.keys()]
  const finished = await completedLevelBy(ids, cfg.completionLevel).catch(() => new Set<string>())
  const buddyIds = new Set(profiles.filter((p) => p.active).map((p) => p.discordId))
  const unmatched = ids.filter((id) => !finished.has(id) && !hasBuddy.has(id) && !buddyIds.has(id)).sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
  return {
    enabled,
    introThreadsEnabled,
    rewardEnabled,
    cap: cfg.cap,
    completionLevel: cfg.completionLevel,
    buddies: profiles.map((p) => ({
      discordId: p.discordId,
      name: nameOf(p.discordId),
      active: p.active,
      paused: p.paused,
      maxActive: p.maxActive,
      activeCount: activeByBuddy.get(p.discordId) ?? 0,
      capacity: Math.max(1, Math.min(p.maxActive, cfg.cap)),
      addedBy: p.addedBy,
    })),
    trainees: unmatched.slice(0, TRAINEE_LIMIT).map((id) => ({ discordId: id, name: nameOf(id) })),
    traineesTruncated: unmatched.length > TRAINEE_LIMIT,
    pairs: pairs.map((p) => ({
      id: p.id,
      status: p.status,
      trainee: { discordId: p.traineeDiscordId, name: nameOf(p.traineeDiscordId) },
      buddy: { discordId: p.buddyDiscordId, name: nameOf(p.buddyDiscordId) },
      threadId: p.threadId,
      createdAt: p.createdAt.toISOString(),
      endedReason: p.endedReason,
      lastEvent: p.events[0]?.kind ?? null,
    })),
  }
}
