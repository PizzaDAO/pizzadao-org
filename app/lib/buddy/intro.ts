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
import { createPrivateThread, type ThreadResult } from './thread'

export type IntroResult =
  | { mode: 'dry-run'; ok: true }
  | { mode: 'live'; ok: true; threadId: string }
  | { mode: 'live' | 'dry-run'; ok: false; reason: string }

export interface IntroDeps {
  createThread: (input: Parameters<typeof createPrivateThread>[0]) => Promise<ThreadResult>
}

const CLAIM_STALE_MS = 2 * 60 * 1000

const defaultDeps: IntroDeps = { createThread: (input) => createPrivateThread(input) }

export async function introducePair(pairId: string, actor: string, deps: IntroDeps = defaultDeps): Promise<IntroResult> {
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
    await prisma.buddyPair.updateMany({ where: { id: pairId }, data: { introStartedAt: null } })
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
