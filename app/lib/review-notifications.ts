import { Prisma } from '@prisma/client'
import { prisma } from './db'

/**
 * The "Mission Needs Review" notifications (MISSION_SUBMITTED) go to every reviewer, so when a
 * submission leaves PENDING (approved, rejected, released, auto-verified) they must be marked
 * read for all of them, or the reviewers' popups fill with stale items.
 *
 * New rows carry `{ completionId, missionId }` in metadata. Legacy rows have metadata = null
 * and only the submitter (actorId) and the mission title inside the message text; those are
 * matched by actorId + the quoted title (see legacyTitleFragments).
 */

/** The review queue lives on the missions page (the reviewer panel); there is no per-item page. */
export const REVIEW_LINK_URL = '/missions'

const TITLE_LIMIT = 50

/** Same cut as the message builders in missions.ts (truncate) and mission-verify/engine.ts (slice). */
export function legacyTitleFragments(missionTitle: string): string[] {
  const truncated = missionTitle.length <= TITLE_LIMIT ? missionTitle : missionTitle.slice(0, TITLE_LIMIT - 3) + '...'
  const sliced = missionTitle.slice(0, TITLE_LIMIT)
  return [...new Set([truncated, sliced].map((t) => `"${t}"`))]
}

/** Whether a legacy notification message is about this mission title. */
export function legacyMessageMatches(message: string, missionTitle: string): boolean {
  return legacyTitleFragments(missionTitle).some((f) => message.includes(f))
}

/** The completionId a new-style notification carries, or null (legacy / malformed). */
export function metadataCompletionId(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const id = (metadata as Record<string, unknown>).completionId
  return typeof id === 'number' && Number.isInteger(id) ? id : null
}

export type ReviewNotificationRow = { id: string; actorId: string | null; message: string; metadata: unknown }
export type ReviewCompletionRow = { id: number; discordId: string; status: string; mission: { title: string } }

/**
 * Which unread MISSION_SUBMITTED rows are stale: their completion exists and is no longer PENDING.
 * Rows that match no completion (deleted, unrecognisable text) are returned as `unmatched` and
 * left alone. A legacy row is kept while any completion it could be about is still PENDING.
 */
export function planStaleReviews(
  notifications: ReviewNotificationRow[],
  completions: ReviewCompletionRow[],
): { stale: string[]; pending: string[]; unmatched: string[] } {
  const byId = new Map(completions.map((c) => [c.id, c]))
  const byActor = new Map<string, ReviewCompletionRow[]>()
  for (const c of completions) byActor.set(c.discordId, [...(byActor.get(c.discordId) ?? []), c])

  const stale: string[] = []
  const pending: string[] = []
  const unmatched: string[] = []
  for (const n of notifications) {
    const cid = metadataCompletionId(n.metadata)
    const matches =
      cid !== null
        ? [byId.get(cid)].filter((c): c is ReviewCompletionRow => !!c)
        : (n.actorId ? (byActor.get(n.actorId) ?? []) : []).filter((c) => legacyMessageMatches(n.message, c.mission.title))
    if (!matches.length) unmatched.push(n.id)
    else if (matches.some((c) => c.status === 'PENDING')) pending.push(n.id)
    else stale.push(n.id)
  }
  return { stale, pending, unmatched }
}

/** The where clause matching every unread review notification of one completion (both styles). */
export function reviewNotificationWhere(c: { id: number; discordId: string; missionTitle: string }): Prisma.NotificationWhereInput {
  return {
    type: 'MISSION_SUBMITTED',
    readAt: null,
    OR: [
      { metadata: { path: ['completionId'], equals: c.id } },
      {
        metadata: { equals: Prisma.DbNull },
        actorId: c.discordId,
        OR: legacyTitleFragments(c.missionTitle).map((f) => ({ message: { contains: f } })),
      },
    ],
  }
}

/**
 * Mark the review notifications of a completion read for every recipient. Fail-soft: a failure
 * is logged and swallowed, it must never break the review action. Returns the rows marked.
 */
export async function clearReviewNotifications(completionId: number): Promise<number> {
  try {
    const completion = await prisma.missionCompletion.findUnique({
      where: { id: completionId },
      select: { id: true, discordId: true, mission: { select: { title: true } } },
    })
    if (!completion) return 0
    const r = await prisma.notification.updateMany({
      where: reviewNotificationWhere({ id: completion.id, discordId: completion.discordId, missionTitle: completion.mission.title }),
      data: { readAt: new Date() },
    })
    return r.count
  } catch (e) {
    console.error(`[review-notifications] clearing completion ${completionId} failed:`, e)
    return 0
  }
}

/** Same, for a completion known only by member + mission (the verifier engine). */
export async function clearReviewNotificationsFor(discordId: string, missionId: number): Promise<number> {
  try {
    const completion = await prisma.missionCompletion.findUnique({
      where: { missionId_discordId: { missionId, discordId } },
      select: { id: true },
    })
    return completion ? await clearReviewNotifications(completion.id) : 0
  } catch (e) {
    console.error(`[review-notifications] clearing ${discordId}/${missionId} failed:`, e)
    return 0
  }
}
