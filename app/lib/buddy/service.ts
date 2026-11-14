/**
 * Buddy system service (plans/buddy-system.md, phase 1: manual matching): the buddy profile, pairs
 * made and ended by admins, and completion when the trainee reaches the configured level.
 * The rules themselves live in ./rules; this file loads the facts and writes the rows.
 */
import { prisma } from '@/app/lib/db'
import { loadSettings } from '@/app/lib/settings'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { getCurrentLevel } from '@/app/lib/missions'
import { fetchMemberIdByDiscordId } from '@/app/lib/sheets/member-repository'
import { ACTIVE_PAIR_STATUSES, buddyCapacity, checkPairing, hasTraineeFinished, isBuddyEligible, type PairRefusal } from './rules'
import { rewardBuddy } from './reward'
import { cancelForNoAccess, introducePair } from './intro'

const SNOWFLAKE = /^\d{5,25}$/
export const isSnowflake = (v: unknown): v is string => typeof v === 'string' && SNOWFLAKE.test(v)
const ACTIVE = [...ACTIVE_PAIR_STATUSES]
/** Serialises pairing per buddy so the capacity check and the insert cannot race (transaction-scoped advisory lock). */
const LOCK_KEY = 742019350

export async function buddySettings() {
  const s = await loadSettings()
  return {
    minLevel: s.get('buddy.minLevel'),
    cap: s.get('buddy.maxActivePerBuddy'),
    completionLevel: s.get('buddy.completionLevel'),
    rewardMissionId: s.get('buddy.rewardMissionId'),
    introText: s.get('buddy.introText'),
    introRecheckHours: s.get('buddy.introRecheckHours'),
  }
}

export interface ProfileInput {
  active?: boolean
  paused?: boolean
  maxActive?: number
  languages?: string[]
}

export type ProfileResult =
  | { ok: true; profile: { active: boolean; paused: boolean; maxActive: number; languages: string[] } }
  | { ok: false; reason: 'disabled' | 'not_eligible' | 'bad_input' }

/** A member opts in, pauses or leaves. Opting in needs the minimum level (an admin-added buddy is exempt). */
export async function saveOwnProfile(discordId: string, input: ProfileInput): Promise<ProfileResult> {
  if (!(await toggleEnabled('buddy.enabled'))) return { ok: false, reason: 'disabled' }
  if (!isSnowflake(discordId)) return { ok: false, reason: 'bad_input' }
  const cfg = await buddySettings()
  const existing = await prisma.buddyProfile.findUnique({ where: { discordId } })
  // An admin removal sticks: the member cannot opt back in until an admin re-adds them.
  if (existing?.removedAt) return { ok: false, reason: 'not_eligible' }
  // No row is created unless the member is opting in (and, below, passes the level gate).
  if (!existing && input.active !== true) return { ok: false, reason: 'bad_input' }
  if (input.active === true && !existing?.active) {
    const exempt = !!existing?.addedBy
    if (!exempt && !isBuddyEligible(await getCurrentLevel(discordId), cfg.minLevel)) return { ok: false, reason: 'not_eligible' }
  }
  const languages = (input.languages ?? existing?.languages ?? []).map((l) => l.trim().slice(0, 40)).filter(Boolean).slice(0, 8)
  const maxActive = buddyCapacity(input.maxActive ?? existing?.maxActive ?? cfg.cap, cfg.cap)
  const memberId = existing?.memberId ?? (await fetchMemberIdByDiscordId(discordId).catch(() => null))
  const data = {
    memberId,
    active: input.active ?? existing?.active ?? false,
    paused: input.paused ?? existing?.paused ?? false,
    maxActive,
    languages,
  }
  const row = await prisma.buddyProfile.upsert({ where: { discordId }, create: { discordId, ...data }, update: data })
  return { ok: true, profile: { active: row.active, paused: row.paused, maxActive: row.maxActive, languages: row.languages } }
}

/** Admin: make someone a buddy by hand (no level check). */
export async function adminAddBuddy(discordId: string, actor: string): Promise<{ ok: true } | { ok: false; reason: 'bad_input' }> {
  if (!isSnowflake(discordId)) return { ok: false, reason: 'bad_input' }
  const cfg = await buddySettings()
  const memberId = await fetchMemberIdByDiscordId(discordId).catch(() => null)
  const data = { memberId, active: true, paused: false, addedBy: actor, removedAt: null }
  await prisma.buddyProfile.upsert({
    where: { discordId },
    create: { discordId, maxActive: buddyCapacity(cfg.cap, cfg.cap), ...data },
    update: data,
  })
  return { ok: true }
}

/**
 * Admin: stop someone being offered as a buddy. Their current pairs are left alone (end them separately).
 * The removal sticks: addedBy is cleared and removedAt set, so the member cannot opt back in (an admin can re-add).
 */
export async function adminRemoveBuddy(discordId: string): Promise<{ ok: boolean }> {
  const r = await prisma.buddyProfile.updateMany({ where: { discordId }, data: { active: false, addedBy: null, removedAt: new Date() } })
  return { ok: r.count > 0 }
}

export type CreatePairResult =
  | { ok: true; pairId: string; traineeMemberId: string | null }
  | { ok: false; reason: PairRefusal | 'disabled' | 'bad_input' }

const isUniqueViolation = (err: unknown) => typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002'

/** Admin: pair a trainee with a buddy, enforcing one active buddy per trainee and the buddy's load cap. */
export async function createPair(input: { traineeDiscordId: string; buddyDiscordId: string }, actor: string): Promise<CreatePairResult> {
  if (!(await toggleEnabled('buddy.enabled'))) return { ok: false, reason: 'disabled' }
  const { traineeDiscordId, buddyDiscordId } = input
  if (!isSnowflake(traineeDiscordId) || !isSnowflake(buddyDiscordId)) return { ok: false, reason: 'bad_input' }
  const cfg = await buddySettings()
  const [traineeLevel, traineeMemberId] = await Promise.all([
    getCurrentLevel(traineeDiscordId),
    fetchMemberIdByDiscordId(traineeDiscordId).catch(() => null),
  ])
  const traineeFinished = hasTraineeFinished(traineeLevel, cfg.completionLevel)
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_KEY}::int, hashtext(${buddyDiscordId}))`
      const [buddy, buddyActiveCount, traineeActiveCount] = await Promise.all([
        tx.buddyProfile.findUnique({ where: { discordId: buddyDiscordId } }),
        tx.buddyPair.count({ where: { buddyDiscordId, status: { in: ACTIVE } } }),
        tx.buddyPair.count({ where: { traineeDiscordId, status: { in: ACTIVE } } }),
      ])
      const refusal = checkPairing({
        traineeDiscordId,
        buddyDiscordId,
        buddy: buddy ? { active: buddy.active, paused: buddy.paused, maxActive: buddy.maxActive } : null,
        buddyActiveCount,
        traineeActiveCount,
        traineeFinished,
        capacityCap: cfg.cap,
      })
      if (refusal) return { ok: false as const, reason: refusal }
      const pair = await tx.buddyPair.create({
        data: { traineeDiscordId, traineeMemberId, buddyDiscordId, status: 'MATCHED', createdBy: actor },
      })
      await tx.buddyEvent.create({ data: { pairId: pair.id, kind: 'paired', actor, data: { manual: true } } })
      await tx.buddyProfile.update({ where: { discordId: buddyDiscordId }, data: { lastMatchedAt: new Date() } })
      return { ok: true as const, pairId: pair.id, traineeMemberId }
    })
  } catch (err) {
    // The partial unique index is the backstop for two admins pairing the same trainee at once.
    if (isUniqueViolation(err)) return { ok: false, reason: 'trainee_has_buddy' }
    throw err
  }
}

/** End a pair that is still active. `actor` is the admin, or 'system'. */
export async function endPair(pairId: string, actor: string, reason: string): Promise<{ ok: boolean }> {
  const clean = reason.trim().slice(0, 200) || 'ended'
  const r = await prisma.buddyPair.updateMany({
    where: { id: pairId, status: { in: ACTIVE } },
    data: { status: 'ENDED', endedReason: clean },
  })
  if (r.count !== 1) return { ok: false }
  await prisma.buddyEvent.create({ data: { pairId, kind: 'ended', actor, data: { reason: clean } } })
  return { ok: true }
}

interface ActivePair {
  id: string
  traineeDiscordId: string
  buddyDiscordId: string
}

/**
 * Complete a pair if its trainee has finished the configured level. Exactly one caller wins the
 * conditional status change, so the completion event and the reward happen once.
 */
export async function completeIfDue(pair: ActivePair, traineeLevel: number, completionLevel: number): Promise<boolean> {
  if (!hasTraineeFinished(traineeLevel, completionLevel)) return false
  const won = await prisma.buddyPair.updateMany({
    where: { id: pair.id, status: { in: ACTIVE } },
    data: { status: 'COMPLETED', completedAt: new Date() },
  })
  if (won.count !== 1) return false
  await prisma.buddyEvent.create({ data: { pairId: pair.id, kind: 'completed', actor: 'system', data: { traineeLevel } } })
  try {
    await rewardBuddy({ pairId: pair.id, buddyDiscordId: pair.buddyDiscordId })
  } catch (e) {
    console.error('[buddy] reward failed', pair.id, e)
    // Recorded so the daily run / admin "Check now" retries it (retryPendingRewards).
    await prisma.buddyEvent
      .create({ data: { pairId: pair.id, kind: 'reward_pending', actor: 'system', data: { error: e instanceof Error ? e.message.slice(0, 200) : 'unknown' } } })
      .catch(() => {})
  }
  return true
}

const REWARD_DONE_KINDS = ['reward_granted', 'reward_skipped']

/**
 * Retry the rewards that failed at completion (a `reward_pending` event and no granted/skipped one yet).
 * Only while buddy.rewardEnabled is on. rewardBuddy writes its own outcome row, so a pair is retried until it has one.
 */
export async function retryPendingRewards(limit = 50): Promise<number> {
  if (!(await toggleEnabled('buddy.rewardEnabled'))) return 0
  const pairs = await prisma.buddyPair.findMany({
    where: { status: 'COMPLETED', events: { some: { kind: 'reward_pending' }, none: { kind: { in: REWARD_DONE_KINDS } } } },
    select: { id: true, buddyDiscordId: true },
    take: limit,
  })
  let rewarded = 0
  for (const pair of pairs) {
    try {
      await rewardBuddy({ pairId: pair.id, buddyDiscordId: pair.buddyDiscordId })
      rewarded++
    } catch (e) {
      console.error('[buddy] reward retry failed', pair.id, e)
    }
  }
  return rewarded
}

export interface DeferredIntroRun {
  opened: number
  waiting: number
  cancelled: number
  /** Cancellations the safety brake held back (more than buddy.maxCancelsPerRun in one run). */
  held: number
}

/**
 * Retry intros that are waiting for channel access (an intro_deferred event, still MATCHED, no thread yet),
 * oldest pair first. Only while buddy.introThreadsEnabled is on. Pairs still inside their recheck wait are
 * skipped before the cap is applied. introducePair opens the thread when both can view; when the wait is over
 * and someone still cannot, the pair is due for cancelling. Safety brake: if more than buddy.maxCancelsPerRun
 * pairs are due in one run (a channel permission change would do that), none are cancelled; each gets a
 * cancel_held event that /admin/buddies shows as a warning.
 */
export async function retryDeferredIntros(limit = 50): Promise<DeferredIntroRun> {
  const out: DeferredIntroRun = { opened: 0, waiting: 0, cancelled: 0, held: 0 }
  if (!(await toggleEnabled('buddy.introThreadsEnabled'))) return out
  const settings = await loadSettings()
  const waitMs = settings.get('buddy.introRecheckHours') * 3600 * 1000
  const maxCancels = settings.get('buddy.maxCancelsPerRun')
  const pairs = await prisma.buddyPair.findMany({
    where: { status: 'MATCHED', introducedAt: null, threadId: null, events: { some: { kind: 'intro_deferred' } } },
    orderBy: { createdAt: 'asc' },
    take: 500,
    select: { id: true, events: { where: { kind: 'intro_deferred', data: { path: ['reason'], equals: 'cannot_view' } }, orderBy: { at: 'desc' }, take: 1, select: { at: true } } },
  })
  const now = Date.now()
  const due = pairs
    .filter((p) => {
      const at = p.events[0]?.at
      if (at && now - new Date(at).getTime() < waitMs) {
        out.waiting++
        return false
      }
      return true
    })
    .slice(0, limit)
  const cancels: Array<{ id: string; who: string[] }> = []
  for (const pair of due) {
    try {
      const r = await introducePair(pair.id, 'system', {}, { deferCancel: true })
      if (r.ok) out.opened++
      else if ('cancelDue' in r && r.cancelDue) cancels.push({ id: pair.id, who: r.cancelDue.who })
      else out.waiting++
    } catch (e) {
      console.error('[buddy] deferred intro failed', pair.id, e)
    }
  }
  if (cancels.length > maxCancels) {
    out.held = cancels.length
    console.error(`[buddy] ${cancels.length} intros are due to be cancelled for no channel access (limit ${maxCancels}): cancelling none`)
    for (const c of cancels) {
      const flagged = await prisma.buddyEvent.findFirst({ where: { pairId: c.id, kind: 'cancel_held' }, select: { id: true } })
      if (!flagged) {
        await prisma.buddyEvent
          .create({ data: { pairId: c.id, kind: 'cancel_held', actor: 'system', data: { reason: 'no_channel_access', who: c.who, due: cancels.length, limit: maxCancels } } })
          .catch(() => {})
      }
    }
    return out
  }
  for (const c of cancels) {
    if (await cancelForNoAccess(c.id, c.who, 'system')) out.cancelled++
    else out.waiting++
  }
  return out
}

/** Check every active pair and complete the ones whose trainee is done. Used by the daily run and the admin page. */
export async function completeDuePairs(): Promise<{ checked: number; completed: number; rewardsRetried: number; intros?: DeferredIntroRun }> {
  if (!(await toggleEnabled('buddy.enabled'))) return { checked: 0, completed: 0, rewardsRetried: 0 }
  const cfg = await buddySettings()
  const pairs = await prisma.buddyPair.findMany({
    where: { status: { in: ACTIVE } },
    select: { id: true, traineeDiscordId: true, buddyDiscordId: true },
  })
  let completed = 0
  for (const pair of pairs) {
    const level = await getCurrentLevel(pair.traineeDiscordId)
    if (await completeIfDue(pair, level, cfg.completionLevel)) completed++
  }
  const rewardsRetried = await retryPendingRewards()
  const intros = await retryDeferredIntros().catch((e) => {
    console.error('[buddy] deferred intros failed', e)
    return undefined
  })
  return { checked: pairs.length, completed, rewardsRetried, ...(intros ? { intros } : {}) }
}
