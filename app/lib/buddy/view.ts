/**
 * Read models for the buddy system: the member dashboard card (both sides of a pair, with the
 * checklist) and the admin page (pool, pairs, unmatched trainees).
 */
import { prisma } from '@/app/lib/db'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { completedLevelBy, getCurrentLevel } from '@/app/lib/missions'
import { readSignedUpMembers } from '@/app/lib/member-registration'
import { fetchMemberByDiscordId, fetchMemberIdByDiscordId } from '@/app/lib/sheets/member-repository'
import { ACTIVE_PAIR_STATUSES, buildChecklist, isBuddyEligible, isActiveStatus, type ChecklistItem } from './rules'
import { buddySettings, completeIfDue } from './service'
import { recognitionEnabled } from './recognition'

const ACTIVE = [...ACTIVE_PAIR_STATUSES]
const RECENT_DONE_MS = 14 * 24 * 60 * 60 * 1000

export interface PairCard {
  id: string
  role: 'buddy' | 'trainee'
  status: string
  partner: { discordId: string; name: string }
  threadUrl: string | null
  /** The intro is waiting until the member can see the buddy channel. */
  waitingForAccess: boolean
  /** Trainee side only: the trainee hides "Onboarded with help from ..." on their public profile. */
  hideRecognition?: boolean
  checklist: ChecklistItem[]
}

export interface MyBuddyState {
  enabled: boolean
  eligible?: boolean
  minLevel?: number
  profile?: { active: boolean; paused: boolean; maxActive: number; languages: string[]; hideRecognition: boolean } | null
  /** buddy.publicRecognitionEnabled is on: the card shows the opt-out. */
  recognitionEnabled?: boolean
  maxActiveCap?: number
  pairs?: PairCard[]
}

function threadUrl(threadId: string | null): string | null {
  const guild = process.env.DISCORD_GUILD_ID
  return threadId && guild ? `https://discord.com/channels/${guild}/${threadId}` : null
}

const LOOKUP_RETRY_MS = 24 * 60 * 60 * 1000

/** The sheet member id, or null. A definite "not a member" is cached per pair and role for a day; a failed read is not. */
async function lookupMemberId(pairId: string | undefined, role: 'trainee' | 'buddy', discordId: string): Promise<string | null> {
  const kind = `member_lookup_missed_${role}`
  if (pairId) {
    const recent = await prisma.buddyEvent
      .findFirst({ where: { pairId, kind, at: { gte: new Date(Date.now() - LOOKUP_RETRY_MS) } }, select: { id: true } })
      .catch(() => null)
    if (recent) return null
  }
  let id: string | null
  try {
    id = await fetchMemberIdByDiscordId(discordId)
  } catch {
    return null
  }
  if (!id && pairId) await prisma.buddyEvent.create({ data: { pairId, kind, actor: 'system' } }).catch(() => {})
  return id
}

/** The facts the checklist ticks from: existing mission, attendance and vouch data. */
export async function loadChecklist(pair: {
  id?: string
  introducedAt: Date | null
  traineeDiscordId: string
  traineeMemberId: string | null
  buddyDiscordId: string
}, traineeLevel: number, completionLevel: number, buddyMemberIdIn: string | null): Promise<ChecklistItem[]> {
  // Lazily backfill ids that were null when the pair / profile was made. A member who is simply not in the sheet
  // is remembered for a day (an event on the pair), so the sheet is not read on every card load for them.
  let { traineeMemberId } = pair
  let buddyMemberId = buddyMemberIdIn
  if (!traineeMemberId) {
    traineeMemberId = await lookupMemberId(pair.id, 'trainee', pair.traineeDiscordId)
    if (traineeMemberId && pair.id) await prisma.buddyPair.updateMany({ where: { id: pair.id, traineeMemberId: null }, data: { traineeMemberId } }).catch(() => {})
  }
  if (!buddyMemberId) {
    buddyMemberId = await lookupMemberId(pair.id, 'buddy', pair.buddyDiscordId)
    if (buddyMemberId) await prisma.buddyProfile.updateMany({ where: { discordId: pair.buddyDiscordId, memberId: null }, data: { memberId: buddyMemberId } }).catch(() => {})
  }
  const [attendance, vouches] = await Promise.all([
    prisma.attendanceSummary.findUnique({ where: { discordId: pair.traineeDiscordId }, select: { totalCalls: true } }),
    traineeMemberId && buddyMemberId
      ? prisma.vouch.count({ where: { followerId: buddyMemberId, followeeId: traineeMemberId } })
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
      include: { events: { where: { kind: { in: ['intro_deferred', 'introduced'] } }, orderBy: { at: 'desc' }, take: 1 } },
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
      threadUrl: row.introducedAt ? threadUrl(row.threadId) : null,
      ...(role === 'trainee' ? { hideRecognition: row.traineeHideRecognition } : {}),
      waitingForAccess: status === 'MATCHED' && !row.introducedAt && row.events[0]?.kind === 'intro_deferred',
      checklist: await loadChecklist(row, traineeLevel, cfg.completionLevel, buddyProfile?.memberId ?? null),
    })
  }
  return {
    enabled: true,
    eligible: !profile?.removedAt && (isBuddyEligible(level, cfg.minLevel) || !!profile?.addedBy),
    minLevel: cfg.minLevel,
    maxActiveCap: cfg.cap,
    recognitionEnabled: await recognitionEnabled().catch(() => false),
    profile: profile ? { active: profile.active, paused: profile.paused, maxActive: profile.maxActive, languages: profile.languages, hideRecognition: profile.hideRecognition } : null,
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
  const [names, profiles, pairs, loadRows, traineeRows] = await Promise.all([
    readSignedUpMembers().catch(() => new Map<string, string>()),
    prisma.buddyProfile.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.buddyPair.findMany({ orderBy: { createdAt: 'desc' }, take: PAIR_LIMIT, include: { events: { orderBy: { at: 'desc' }, take: 1 } } }),
    // Dedicated counts over ALL active pairs: the list above is only the newest PAIR_LIMIT.
    prisma.buddyPair.groupBy({ by: ['buddyDiscordId'], where: { status: { in: ACTIVE } }, _count: { _all: true } }),
    prisma.buddyPair.findMany({ where: { status: { in: ACTIVE } }, select: { traineeDiscordId: true } }),
  ])
  const nameOf = (id: string) => names.get(id) || id
  const activeByBuddy = new Map<string, number>(loadRows.map((r) => [r.buddyDiscordId, r._count._all]))
  const hasBuddy = new Set<string>(traineeRows.map((r) => r.traineeDiscordId))
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
      threadId: p.introducedAt ? p.threadId : null, // a half-made intro shows as not introduced, so Retry intro stays visible
      createdAt: p.createdAt.toISOString(),
      endedReason: p.endedReason,
      lastEvent: p.events[0]?.kind ?? null,
    })),
  }
}
