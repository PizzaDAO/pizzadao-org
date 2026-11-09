/**
 * "Ask a member to vouch for me": an in-app notification (the existing bell) sent to one member.
 *
 *   - the sender has a member profile and the target is a member who can receive notifications
 *   - no requests to yourself
 *   - nothing to ask when the target already vouched for the sender
 *   - no duplicate pending request: an unread request from this sender to this target blocks a new
 *     one (the recipient dismisses a request by marking it read, which frees the pair again)
 *   - at most `vouches.requestDailyLimit` requests per sender per rolling 24 hours
 *
 * - no new request to the same member within `vouches.requestCooldownDays`, by createdAt, read or not
 * The pending/cooldown/limit checks and the insert run in one transaction under a per-sender
 * advisory lock, so parallel requests cannot slip duplicates through.
 *
 * Off unless the `vouches.requestsEnabled` toggle is on (checked by the route).
 */
import { NotificationType } from '@prisma/client'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/app/lib/db'
import { fetchMemberById } from '@/app/lib/sheets/member-repository'
import { findMemberByDiscordId } from '@/app/lib/member-utils'
import { getSetting } from '@/app/lib/settings'

export const DAY_MS = 24 * 60 * 60 * 1000

export type VouchRequestResult =
  | { ok: true; targetName: string }
  | { ok: false; reason: 'no-profile' | 'self' | 'not-found' | 'unreachable' | 'already-vouched' | 'pending' | 'cooldown' }
  | { ok: false; reason: 'limit'; limit: number }

type Db = Prisma.TransactionClient

export interface VouchRequestDeps {
  findSender: (discordId: string) => Promise<{ memberId: string; name: string } | null>
  fetchTarget: (memberId: string) => Promise<Record<string, unknown> | null>
  /** Whether the target has already vouched for the sender. */
  alreadyVouched: (targetMemberId: string, senderMemberId: string) => Promise<boolean>
  /** Runs `fn` serialized per sender (one transaction); the db handle is passed to the calls below. */
  withSenderLock: <T>(senderDiscordId: string, fn: (db: Db | undefined) => Promise<T>) => Promise<T>
  /** An unread request from this sender to this recipient exists. */
  hasPending: (db: Db | undefined, senderDiscordId: string, recipientDiscordId: string) => Promise<boolean>
  /** A request from this sender to this recipient (read or not) was made since `since`. */
  hasRecentPair: (db: Db | undefined, senderDiscordId: string, recipientDiscordId: string, since: Date) => Promise<boolean>
  /** Requests this sender made since `since`. */
  countRecent: (db: Db | undefined, senderDiscordId: string, since: Date) => Promise<number>
  dailyLimit: () => Promise<number>
  cooldownDays: () => Promise<number>
  create: (
    db: Db | undefined,
    input: { senderDiscordId: string; senderMemberId: string; senderName: string; recipientDiscordId: string },
  ) => Promise<unknown>
  now: () => Date
}

export const defaultVouchRequestDeps: VouchRequestDeps = {
  findSender: findMemberByDiscordId,
  fetchTarget: (id) => fetchMemberById(id) as Promise<Record<string, unknown> | null>,
  alreadyVouched: async (targetMemberId, senderMemberId) =>
    (await prisma.vouch.count({ where: { followerId: targetMemberId, followeeId: senderMemberId } })) > 0,
  withSenderLock: (senderDiscordId, fn) =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'vouch-request:' + senderDiscordId}))`
      return fn(tx)
    }),
  hasPending: async (db, senderDiscordId, recipientDiscordId) =>
    ((await (db ?? prisma).notification.count({
      where: { type: NotificationType.VOUCH_REQUEST, actorId: senderDiscordId, recipientId: recipientDiscordId, readAt: null },
    })) as number) > 0,
  hasRecentPair: async (db, senderDiscordId, recipientDiscordId, since) =>
    ((await (db ?? prisma).notification.count({
      where: { type: NotificationType.VOUCH_REQUEST, actorId: senderDiscordId, recipientId: recipientDiscordId, createdAt: { gte: since } },
    })) as number) > 0,
  countRecent: (db, senderDiscordId, since) =>
    (db ?? prisma).notification.count({
      where: { type: NotificationType.VOUCH_REQUEST, actorId: senderDiscordId, createdAt: { gte: since } },
    }),
  dailyLimit: () => getSetting('vouches.requestDailyLimit'),
  cooldownDays: () => getSetting('vouches.requestCooldownDays'),
  create: (db, i) =>
    (db ?? prisma).notification.create({
      data: {
        type: NotificationType.VOUCH_REQUEST,
        recipientId: i.recipientDiscordId,
        actorId: i.senderDiscordId,
        title: 'Vouch request',
        message: `${i.senderName || 'A member'} asked you to vouch for them`,
        metadata: { requesterMemberId: i.senderMemberId },
        linkUrl: `/profile/${encodeURIComponent(i.senderMemberId)}`,
      },
    }),
  now: () => new Date(),
}

export async function requestVouch(
  input: { senderDiscordId: string; targetMemberId: string },
  deps: VouchRequestDeps = defaultVouchRequestDeps,
): Promise<VouchRequestResult> {
  const sender = await deps.findSender(input.senderDiscordId)
  if (!sender?.memberId) return { ok: false, reason: 'no-profile' }
  if (sender.memberId === input.targetMemberId) return { ok: false, reason: 'self' }

  const target = await deps.fetchTarget(input.targetMemberId)
  if (!target) return { ok: false, reason: 'not-found' }
  const recipientDiscordId = String(target['discordId'] ?? '').trim()
  if (!recipientDiscordId) return { ok: false, reason: 'unreachable' }
  const targetName = String(target['Name'] ?? target['Mafia Name'] ?? '').trim()

  if (await deps.alreadyVouched(input.targetMemberId, sender.memberId)) return { ok: false, reason: 'already-vouched' }
  return deps.withSenderLock(input.senderDiscordId, async (db): Promise<VouchRequestResult> => {
    const now = deps.now()
    const cooldownDays = await deps.cooldownDays()
    if (
      cooldownDays > 0 &&
      (await deps.hasRecentPair(db, input.senderDiscordId, recipientDiscordId, new Date(now.getTime() - cooldownDays * DAY_MS)))
    ) {
      return { ok: false, reason: 'cooldown' }
    }
    if (await deps.hasPending(db, input.senderDiscordId, recipientDiscordId)) return { ok: false, reason: 'pending' }

    const limit = await deps.dailyLimit()
    const recent = await deps.countRecent(db, input.senderDiscordId, new Date(now.getTime() - DAY_MS))
    if (recent >= limit) return { ok: false, reason: 'limit', limit }

    await deps.create(db, {
      senderDiscordId: input.senderDiscordId,
      senderMemberId: sender.memberId,
      senderName: sender.name,
      recipientDiscordId,
    })
    return { ok: true, targetName }
  })
}
