/**
 * Public buddy recognition (behind buddy.publicRecognitionEnabled, which also needs buddy.enabled):
 *   - a buddy's profile line: "helped N trainees reach level L" (N = COMPLETED pairs, shown from 1)
 *   - a trainee's profile line: "Onboarded with help from <buddy>" (a COMPLETED pair only)
 *   - the Top buddies list (top 10 by completed pairs, ties by most recent completion)
 * Visibility rules: only COMPLETED pairs ever count (never active, ended or cancelled ones), and a member
 * who opted out (BuddyProfile.hideRecognition for a buddy, BuddyPair.traineeHideRecognition for a trainee)
 * is shown nowhere; a buddy who opted out is not named on trainees' profiles either. Only public fields
 * leave this file: a sheet member id, a display name and counts. No Discord ids.
 */
import { prisma } from '@/app/lib/db'
import { loadSettings } from '@/app/lib/settings'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { fetchMemberByDiscordId } from '@/app/lib/sheets/member-repository'

export const TOP_BUDDIES_LIMIT = 10

export async function recognitionEnabled(): Promise<boolean> {
  const [base, recognition] = await Promise.all([toggleEnabled('buddy.enabled'), toggleEnabled('buddy.publicRecognitionEnabled')])
  return base && recognition
}

export interface BuddyRecognition {
  /** Set when this member has helped at least one trainee finish. */
  asBuddy: { helped: number; level: number } | null
  /** Set when this member finished with a buddy's help. */
  helpedBy: { memberId: string; name: string } | null
}

/** Rank by completed pairs, then by the most recent completion. Pure, so the order is testable. */
export function rankBuddies<T extends { count: number; lastAt: Date | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.count - a.count || (b.lastAt?.getTime() ?? 0) - (a.lastAt?.getTime() ?? 0))
}

/** What a profile page may show for this sheet member id, or null when there is nothing (or the feature is off). */
export async function getBuddyRecognition(memberId: string): Promise<BuddyRecognition | null> {
  if (!memberId || !(await recognitionEnabled())) return null
  const level = (await loadSettings()).get('buddy.completionLevel')
  const out: BuddyRecognition = { asBuddy: null, helpedBy: null }

  const profile = await prisma.buddyProfile.findFirst({ where: { memberId, hideRecognition: false }, select: { discordId: true } })
  if (profile) {
    const helped = await prisma.buddyPair.count({ where: { buddyDiscordId: profile.discordId, status: 'COMPLETED' } })
    if (helped >= 1) out.asBuddy = { helped, level }
  }

  const pair = await prisma.buddyPair.findFirst({
    where: { traineeMemberId: memberId, status: 'COMPLETED', traineeHideRecognition: false },
    orderBy: { completedAt: 'desc' },
    select: { buddyDiscordId: true },
  })
  if (pair) {
    const buddy = await prisma.buddyProfile.findUnique({ where: { discordId: pair.buddyDiscordId }, select: { memberId: true, hideRecognition: true } })
    if (buddy && !buddy.hideRecognition && buddy.memberId) {
      const m = await fetchMemberByDiscordId(pair.buddyDiscordId).catch(() => null)
      if (m?.name) out.helpedBy = { memberId: buddy.memberId, name: m.name }
    }
  }
  return out.asBuddy || out.helpedBy ? out : null
}

export interface TopBuddy {
  memberId: string
  name: string
  helped: number
}

/** The leaderboard, or null when the feature is off. */
export async function getTopBuddies(limit = TOP_BUDDIES_LIMIT): Promise<{ level: number; buddies: TopBuddy[] } | null> {
  if (!(await recognitionEnabled())) return null
  const level = (await loadSettings()).get('buddy.completionLevel')
  const groups = await prisma.buddyPair.groupBy({
    by: ['buddyDiscordId'],
    where: { status: 'COMPLETED' },
    _count: { _all: true },
    _max: { completedAt: true },
  })
  const ranked = rankBuddies(groups.map((g) => ({ discordId: g.buddyDiscordId, count: g._count._all, lastAt: g._max.completedAt })))
  const profiles = await prisma.buddyProfile.findMany({
    where: { discordId: { in: ranked.map((r) => r.discordId) }, hideRecognition: false, memberId: { not: null } },
    select: { discordId: true, memberId: true },
  })
  const byId = new Map(profiles.map((p) => [p.discordId, p.memberId as string]))
  const buddies: TopBuddy[] = []
  for (const r of ranked) {
    if (buddies.length >= limit) break
    const memberId = byId.get(r.discordId)
    if (!memberId) continue
    const m = await fetchMemberByDiscordId(r.discordId).catch(() => null)
    if (!m?.name) continue
    buddies.push({ memberId, name: m.name, helped: r.count })
  }
  return { level, buddies }
}

/** A member's own opt-out. With pairId it is the trainee's flag for that pair; without, the buddy profile's. */
export async function setRecognitionHidden(discordId: string, hide: boolean, pairId?: string): Promise<boolean> {
  if (pairId) {
    const r = await prisma.buddyPair.updateMany({ where: { id: pairId, traineeDiscordId: discordId }, data: { traineeHideRecognition: hide } })
    return r.count > 0
  }
  const r = await prisma.buddyProfile.updateMany({ where: { discordId }, data: { hideRecognition: hide } })
  return r.count > 0
}
