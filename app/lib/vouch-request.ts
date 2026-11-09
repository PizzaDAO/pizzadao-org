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
 * Off unless the `vouches.requestsEnabled` toggle is on (checked by the route).
 */
import { NotificationType } from '@prisma/client'
import { prisma } from '@/app/lib/db'
import { createNotification } from '@/app/lib/notifications'
import { fetchMemberById } from '@/app/lib/sheets/member-repository'
import { findMemberByDiscordId } from '@/app/lib/member-utils'
import { getSetting } from '@/app/lib/settings'

export const DAY_MS = 24 * 60 * 60 * 1000

export type VouchRequestResult =
  | { ok: true; targetName: string }
  | { ok: false; reason: 'no-profile' | 'self' | 'not-found' | 'unreachable' | 'already-vouched' | 'pending' }
  | { ok: false; reason: 'limit'; limit: number }

export interface VouchRequestDeps {
  findSender: (discordId: string) => Promise<{ memberId: string; name: string } | null>
  fetchTarget: (memberId: string) => Promise<Record<string, unknown> | null>
  /** Whether the target has already vouched for the sender. */
  alreadyVouched: (targetMemberId: string, senderMemberId: string) => Promise<boolean>
  /** An unread request from this sender to this recipient exists. */
  hasPending: (senderDiscordId: string, recipientDiscordId: string) => Promise<boolean>
  /** Requests this sender made since `since`. */
  countRecent: (senderDiscordId: string, since: Date) => Promise<number>
  dailyLimit: () => Promise<number>
  create: (input: { senderDiscordId: string; senderMemberId: string; senderName: string; recipientDiscordId: string }) => Promise<unknown>
  now: () => Date
}

export const defaultVouchRequestDeps: VouchRequestDeps = {
  findSender: findMemberByDiscordId,
  fetchTarget: (id) => fetchMemberById(id) as Promise<Record<string, unknown> | null>,
  alreadyVouched: async (targetMemberId, senderMemberId) =>
    (await prisma.vouch.count({ where: { followerId: targetMemberId, followeeId: senderMemberId } })) > 0,
  hasPending: async (senderDiscordId, recipientDiscordId) =>
    (await prisma.notification.count({
      where: { type: NotificationType.VOUCH_REQUEST, actorId: senderDiscordId, recipientId: recipientDiscordId, readAt: null },
    })) > 0,
  countRecent: (senderDiscordId, since) =>
    prisma.notification.count({
      where: { type: NotificationType.VOUCH_REQUEST, actorId: senderDiscordId, createdAt: { gte: since } },
    }),
  dailyLimit: () => getSetting('vouches.requestDailyLimit'),
  create: (i) =>
    createNotification({
      type: NotificationType.VOUCH_REQUEST,
      recipientId: i.recipientDiscordId,
      actorId: i.senderDiscordId,
      title: 'Vouch request',
      message: `${i.senderName || 'A member'} asked you to vouch for them`,
      metadata: { requesterMemberId: i.senderMemberId },
      linkUrl: `/profile/${encodeURIComponent(i.senderMemberId)}`,
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
  if (await deps.hasPending(input.senderDiscordId, recipientDiscordId)) return { ok: false, reason: 'pending' }

  const limit = await deps.dailyLimit()
  const recent = await deps.countRecent(input.senderDiscordId, new Date(deps.now().getTime() - DAY_MS))
  if (recent >= limit) return { ok: false, reason: 'limit', limit }

  await deps.create({
    senderDiscordId: input.senderDiscordId,
    senderMemberId: sender.memberId,
    senderName: sender.name,
    recipientDiscordId,
  })
  return { ok: true, targetName }
}
