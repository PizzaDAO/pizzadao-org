import { Prisma } from '@prisma/client'
import { prisma } from './db'

/**
 * "Needs action" notifications other than missions (see review-notifications.ts for those) stay
 * unread forever once the thing they ask for has been handled, so the app marks them read itself:
 *
 *   - BOUNTY_SUBMITTED    { bountyId }          all recipients, when the bounty leaves SUBMITTED
 *   - VOUCH_REQUEST       { requesterMemberId } only the recipient who vouched, for that requester
 *   - DISAVOW_VOTE_NEEDED { disavowalId }       the voter alone after voting; everyone when the
 *                                               entry's open round closes or is cancelled
 *
 * Every clear is fail-soft (logged and swallowed, returns 0) and runs outside the main
 * transaction, so it can never break the action that triggered it.
 */

/** The value a metadata key holds, or undefined (null / array / missing). */
function metaValue(metadata: unknown, key: string): unknown {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined
  return (metadata as Record<string, unknown>)[key]
}

export function metadataBountyId(metadata: unknown): number | null {
  const v = metaValue(metadata, 'bountyId')
  return typeof v === 'number' && Number.isInteger(v) ? v : null
}

export function metadataRequesterMemberId(metadata: unknown): string | null {
  const v = metaValue(metadata, 'requesterMemberId')
  return typeof v === 'string' && v ? v : null
}

/**
 * The disavowal a DISAVOW_VOTE_NEEDED row is about: metadata.disavowalId, else (legacy rows,
 * metadata null) the id in its link `/disavow/<id>`, which the app always set.
 */
export function disavowalIdOf(row: { metadata: unknown; linkUrl?: string | null }): string | null {
  const v = metaValue(row.metadata, 'disavowalId')
  if (typeof v === 'string' && v) return v
  const m = /^\/disavow\/([^/?#]+)$/.exec(row.linkUrl ?? '')
  return m ? m[1] : null
}

async function markRead(label: string, where: Prisma.NotificationWhereInput): Promise<number> {
  try {
    const r = await prisma.notification.updateMany({ where: { ...where, readAt: null }, data: { readAt: new Date() } })
    return r.count
  } catch (e) {
    console.error(`[action-notifications] clearing ${label} failed:`, e)
    return 0
  }
}

/** The bounty's submission was handled (approved, sent back, cancelled, released): clear it for every reviewer. */
export function clearBountySubmittedNotifications(bountyId: number): Promise<number> {
  return markRead(`bounty ${bountyId}`, { type: 'BOUNTY_SUBMITTED', metadata: { path: ['bountyId'], equals: bountyId } })
}

/** `recipientDiscordId` vouched for `requesterMemberId`: clear that recipient's own request only. */
export function clearVouchRequestNotification(recipientDiscordId: string, requesterMemberId: string): Promise<number> {
  return markRead(`vouch request ${recipientDiscordId}/${requesterMemberId}`, {
    type: 'VOUCH_REQUEST',
    recipientId: recipientDiscordId,
    metadata: { path: ['requesterMemberId'], equals: requesterMemberId },
  })
}

export function disavowVoteWhere(disavowalId: string): Prisma.NotificationWhereInput {
  return {
    type: 'DISAVOW_VOTE_NEEDED',
    OR: [
      { metadata: { path: ['disavowalId'], equals: disavowalId } },
      // Legacy rows have no metadata; their link is exactly /disavow/<id>.
      { metadata: { equals: Prisma.DbNull }, linkUrl: `/disavow/${disavowalId}` },
    ],
  }
}

/** The entry's vote closed or was cancelled: clear it for every recipient. */
export function clearDisavowVoteNotifications(disavowalId: string): Promise<number> {
  return markRead(`disavowal ${disavowalId}`, disavowVoteWhere(disavowalId))
}

/** `voterDiscordId` voted: clear only their own notification. */
export function clearDisavowVoteNotificationFor(disavowalId: string, voterDiscordId: string): Promise<number> {
  return markRead(`disavowal ${disavowalId}/${voterDiscordId}`, { ...disavowVoteWhere(disavowalId), recipientId: voterDiscordId })
}

// ---- stale backlog planning (used by scripts/notifications/clear-stale-reviews.mjs) ----

export type Plan = { stale: string[]; kept: string[]; unmatched: string[] }

/** Unread BOUNTY_SUBMITTED rows whose bounty exists and is no longer SUBMITTED are stale. */
export function planStaleBounties(
  notifications: Array<{ id: string; metadata: unknown }>,
  bounties: Array<{ id: number; status: string }>,
): Plan {
  const byId = new Map(bounties.map((b) => [b.id, b]))
  const plan: Plan = { stale: [], kept: [], unmatched: [] }
  for (const n of notifications) {
    const id = metadataBountyId(n.metadata)
    const b = id === null ? undefined : byId.get(id)
    if (!b) plan.unmatched.push(n.id)
    else if (b.status === 'SUBMITTED') plan.kept.push(n.id)
    else plan.stale.push(n.id)
  }
  return plan
}

/**
 * Unread VOUCH_REQUEST rows are stale when the recipient already vouched for the requester.
 * `memberIdByDiscordId` maps recipients to member ids; `vouched` holds "followerId>followeeId".
 * A recipient we cannot resolve is left alone.
 */
export function planStaleVouchRequests(
  notifications: Array<{ id: string; recipientId: string; metadata: unknown }>,
  memberIdByDiscordId: Map<string, string>,
  vouched: Set<string>,
): Plan {
  const plan: Plan = { stale: [], kept: [], unmatched: [] }
  for (const n of notifications) {
    const requester = metadataRequesterMemberId(n.metadata)
    const me = memberIdByDiscordId.get(n.recipientId)
    if (!requester || !me) plan.unmatched.push(n.id)
    else if (vouched.has(`${me}>${requester}`)) plan.stale.push(n.id)
    else plan.kept.push(n.id)
  }
  return plan
}

/**
 * Unread DISAVOW_VOTE_NEEDED rows are stale when their disavowal has no OPEN round any more
 * (`openRoundVoters` null), or the recipient has a vote on its open round. Rows whose disavowal
 * can't be identified or no longer exists are left alone.
 */
export function planStaleDisavowVotes(
  notifications: Array<{ id: string; recipientId: string; metadata: unknown; linkUrl: string | null }>,
  disavowals: Array<{ id: string; openRoundVoters: string[] | null }>,
): Plan {
  const byId = new Map(disavowals.map((d) => [d.id, d]))
  const plan: Plan = { stale: [], kept: [], unmatched: [] }
  for (const n of notifications) {
    const id = disavowalIdOf(n)
    const d = id === null ? undefined : byId.get(id)
    if (!d) plan.unmatched.push(n.id)
    else if (d.openRoundVoters === null || d.openRoundVoters.includes(n.recipientId)) plan.stale.push(n.id)
    else plan.kept.push(n.id)
  }
  return plan
}
