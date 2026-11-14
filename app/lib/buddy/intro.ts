/**
 * Introduce a pair: the bot opens a private thread in the configured buddy channel and posts the
 * intro. Behind buddy.introThreadsEnabled: while it is off nothing goes to Discord and the pair history
 * gets an `intro_dry_run` row with what would have been posted.
 */
import { prisma } from '@/app/lib/db'
import { loadSettings } from '@/app/lib/settings'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { savedChannelId } from '@/app/lib/settings/channels'
import { fetchMemberByDiscordId } from '@/app/lib/sheets/member-repository'
import { renderIntro, threadName } from './rules'
import { userCanViewChannel, type ViewAccess } from '@/app/lib/discord-permissions'
import { createPrivateThread, type ThreadResult } from './thread'

export type IntroResult =
  | { mode: 'dry-run'; ok: true }
  | { mode: 'live'; ok: true; threadId: string }
  | { mode: 'live' | 'dry-run'; ok: false; reason: string; waiting?: true; cancelled?: true; uncertain?: true; cancelDue?: { who: string[] } }

export interface IntroDeps {
  createThread: (input: Parameters<typeof createPrivateThread>[0]) => Promise<ThreadResult>
  /** Can this person view the buddy channel? */
  canView: (channelId: string, userId: string) => Promise<ViewAccess>
}

const CLAIM_STALE_MS = 2 * 60 * 1000

const defaultDeps: IntroDeps = {
  createThread: (input) => createPrivateThread(input),
  canView: (channelId, userId) => userCanViewChannel(userId, channelId),
}

const ACTIVE = ['MATCHED', 'INTRODUCED']

/** Cancel a pair whose people still cannot see the buddy channel. Respects an active intro claim. */
export async function cancelForNoAccess(pairId: string, who: string[], actor: string): Promise<boolean> {
  const stale = new Date(Date.now() - CLAIM_STALE_MS)
  const ended = await prisma.buddyPair.updateMany({
    where: {
      id: pairId,
      status: { in: ACTIVE },
      introducedAt: null,
      OR: [{ introStartedAt: null }, { introStartedAt: { lt: stale } }],
    },
    data: { status: 'ENDED', endedReason: 'no_channel_access' },
  })
  if (ended.count !== 1) return false
  await prisma.buddyEvent.create({ data: { pairId, kind: 'ended', actor, data: { reason: 'no_channel_access', who } } })
  return true
}

/**
 * Both people must be able to see the (role-restricted) buddy channel before a thread opens there. The first
 * time someone definitely cannot, the pair waits: an intro_deferred event (reason cannot_view) starts the
 * recheck clock (buddy.introRecheckHours). Checked again every hour, the intro opens as soon as both can view;
 * the first failed check after the wait cancels the pair (ENDED, no_channel_access) so the trainee is unmatched
 * again (with deferCancel the caller does the cancelling, after its safety brake). Discord being unreachable
 * ('unknown') starts no clock and cancels nothing; it only records an intro_deferred (reason unknown) once so
 * the hourly retry picks the pair up.
 */
async function accessGate(pair: { id: string; traineeDiscordId: string; buddyDiscordId: string }, channelId: string, actor: string, mode: 'live', deps: IntroDeps, deferCancel: boolean): Promise<IntroResult | null> {
  const [trainee, buddy] = await Promise.all([deps.canView(channelId, pair.traineeDiscordId), deps.canView(channelId, pair.buddyDiscordId)])
  const who = [trainee === 'no' ? 'trainee' : null, buddy === 'no' ? 'buddy' : null].filter((w): w is string => !!w)
  if (who.length === 0) {
    if (trainee !== 'unknown' && buddy !== 'unknown') return null
    const any = await prisma.buddyEvent.findFirst({ where: { pairId: pair.id, kind: 'intro_deferred' }, select: { id: true } })
    if (!any) await prisma.buddyEvent.create({ data: { pairId: pair.id, kind: 'intro_deferred', actor, data: { reason: 'unknown' } } })
    return { mode, ok: false, reason: 'access_unknown' }
  }

  const hours = (await loadSettings()).get('buddy.introRecheckHours')
  const prior = await prisma.buddyEvent.findFirst({
    where: { pairId: pair.id, kind: 'intro_deferred', data: { path: ['reason'], equals: 'cannot_view' } },
    orderBy: { at: 'desc' },
  })
  if (!prior) {
    await prisma.buddyEvent.create({ data: { pairId: pair.id, kind: 'intro_deferred', actor, data: { reason: 'cannot_view', who, recheckHours: hours } } })
    return { mode, ok: false, reason: 'waiting_for_access', waiting: true }
  }
  if (Date.now() - new Date(prior.at).getTime() < hours * 3600 * 1000) return { mode, ok: false, reason: 'waiting_for_access', waiting: true }
  if (deferCancel) return { mode, ok: false, reason: 'no_channel_access', cancelDue: { who } }
  const cancelled = await cancelForNoAccess(pair.id, who, actor)
  return cancelled ? { mode, ok: false, reason: 'no_channel_access', cancelled: true } : { mode, ok: false, reason: 'intro_in_progress' }
}

/** An earlier attempt may have created a thread whose answer was lost: no second thread until an admin resolves it. */
async function blockedByUncertainCreate(pairId: string): Promise<boolean> {
  const last = await prisma.buddyEvent.findFirst({ where: { pairId, kind: { in: ['intro_uncertain', 'intro_uncertain_resolved'] } }, orderBy: { at: 'desc' } })
  if (!last || last.kind !== 'intro_uncertain') return false
  return !(last.data as { threadId?: string } | null)?.threadId
}

/** Admin: after checking Discord, clear an uncertain thread-create. With a thread id the pair reuses that thread. */
export async function resolveUncertainIntro(pairId: string, actor: string, threadId?: string): Promise<boolean> {
  const pair = await prisma.buddyPair.findUnique({ where: { id: pairId } })
  if (!pair || pair.introducedAt) return false
  await prisma.buddyPair.updateMany({
    where: { id: pairId, introducedAt: null },
    data: { introStartedAt: null, ...(threadId && !pair.threadId ? { threadId } : {}) },
  })
  await prisma.buddyEvent.create({ data: { pairId, kind: 'intro_uncertain_resolved', actor, data: threadId ? { threadId } : {} } })
  return true
}

export async function introducePair(pairId: string, actor: string, depsIn: Partial<IntroDeps> = {}, opts: { deferCancel?: boolean } = {}): Promise<IntroResult> {
  const deps: IntroDeps = { ...defaultDeps, ...depsIn }
  const pair = await prisma.buddyPair.findUnique({ where: { id: pairId } })
  if (!pair) return { mode: 'dry-run', ok: false, reason: 'pair_not_found' }
  if (pair.status !== 'MATCHED' && pair.status !== 'INTRODUCED') return { mode: 'dry-run', ok: false, reason: 'pair_not_active' }
  // A thread without introducedAt is a half-made intro (the thread exists but the members or the post failed): Retry reuses it.
  if (pair.threadId && pair.introducedAt) return { mode: 'live', ok: false, reason: 'already_introduced' }

  const live = await toggleEnabled('buddy.introThreadsEnabled')
  const mode = live ? 'live' : 'dry-run'
  const [trainee, template, channelId] = await Promise.all([
    fetchMemberByDiscordId(pair.traineeDiscordId).catch(() => null),
    loadSettings().then((s) => s.get('buddy.introText')),
    savedChannelId('discord.buddyChannelId'),
  ])
  const content = renderIntro(template, { traineeDiscordId: pair.traineeDiscordId, buddyDiscordId: pair.buddyDiscordId })
  const name = threadName(trainee?.name ?? '')

  if (!live) {
    await prisma.buddyEvent.create({ data: { pairId, kind: 'intro_dry_run', actor, data: { channelId: channelId || null, name, content } } })
    return { mode: 'dry-run', ok: true }
  }
  if (!channelId) {
    await prisma.buddyEvent.create({ data: { pairId, kind: 'intro_failed', actor, data: { reason: 'no_channel' } } })
    return { mode, ok: false, reason: 'no_channel' }
  }
  // A half-made intro (thread exists) already had both people added, so only a fresh intro is gated.
  if (!pair.threadId) {
    if (await blockedByUncertainCreate(pairId)) return { mode, ok: false, reason: 'intro_uncertain', uncertain: true }
    const blocked = await accessGate(pair, channelId, actor, 'live', deps, !!opts.deferCancel)
    if (blocked) return blocked
  }
  // Claim the pair before calling Discord so two concurrent intros cannot make two threads. A claim older
  // than CLAIM_STALE_MS (a crashed run) can be taken over.
  const now = new Date()
  const claim = await prisma.buddyPair.updateMany({
    where: {
      id: pairId,
      introducedAt: null,
      status: { in: ['MATCHED', 'INTRODUCED'] },
      OR: [{ introStartedAt: null }, { introStartedAt: { lt: new Date(now.getTime() - CLAIM_STALE_MS) } }],
    },
    data: { introStartedAt: now },
  })
  if (claim.count !== 1) return { mode, ok: false, reason: 'intro_in_progress' }

  const result = await deps.createThread({
    channelId,
    name,
    content,
    userIds: [pair.traineeDiscordId, pair.buddyDiscordId],
    ...(pair.threadId ? { existingThreadId: pair.threadId } : {}),
  })
  if (!result.ok) {
    // Keep a thread that was made before the failure, so Retry reuses it instead of opening another.
    if (result.threadId && !pair.threadId) {
      await prisma.buddyPair.updateMany({ where: { id: pairId, threadId: null }, data: { threadId: result.threadId } })
    }
    if (result.uncertain) {
      // The post may have gone out: keep the claim (no automatic repost) and let an admin resolve it. A retry
      // re-reads the thread's messages and only posts when the intro is really missing.
      await prisma.buddyEvent.create({ data: { pairId, kind: 'intro_uncertain', actor, data: { reason: result.reason, ...(result.threadId ? { threadId: result.threadId } : {}) } } })
      return { mode, ok: false, reason: result.reason, uncertain: true }
    }
    await prisma.buddyPair.updateMany({ where: { id: pairId, introStartedAt: now }, data: { introStartedAt: null } })
    await prisma.buddyEvent.create({ data: { pairId, kind: 'intro_failed', actor, data: { reason: result.reason, ...(result.threadId ? { threadId: result.threadId } : {}) } } })
    return { mode, ok: false, reason: result.reason }
  }
  const done = await prisma.buddyPair.updateMany({
    where: { id: pairId, introducedAt: null, status: { in: ['MATCHED', 'INTRODUCED'] } },
    data: { threadId: result.threadId, status: 'INTRODUCED', introducedAt: new Date(), introStartedAt: null },
  })
  await prisma.buddyEvent.create({ data: { pairId, kind: 'introduced', actor, data: { threadId: result.threadId, recorded: done.count === 1 } } })
  return { mode, ok: true, threadId: result.threadId }
}
