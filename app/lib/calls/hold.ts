/**
 * Owner-only hold on a call. A held call is hidden from capos (they get a 404) and only Dread Pizza
 * Roberts can publish it. A capo may put a call on hold; only the owner may release one. The note is
 * private (never shown in Discord or publicly), at most 300 characters.
 */
import { prisma } from '@/app/lib/db'
import { recordCallReviewEvent, type CallReviewVia } from '@/app/lib/calls/review-audit'
import { autoHoldReason } from '@/app/lib/calls/access'
import type { PostFilter } from '@/app/lib/calls/post-filters'

export const HOLD_NOTE_MAX = 300

export type HoldResult = 'ok' | 'already' | 'not-found'
export type ReleaseResult = 'ok' | 'not-held' | 'not-found'

export async function setHold(id: string, actorId: string, note: string | null | undefined, via: CallReviewVia = 'web'): Promise<HoldResult> {
  const clean = (note ?? '').trim().slice(0, HOLD_NOTE_MAX) || null
  const res = await prisma.callRecording.updateMany({ where: { id, reviewHoldAt: null }, data: { reviewHoldAt: new Date(), reviewHoldBy: actorId, reviewHoldNote: clean } })
  if (res.count === 1) {
    await recordCallReviewEvent({ recordingId: id, actorId, action: 'hold', via }, { always: true })
    return 'ok'
  }
  const exists = await prisma.callRecording.findUnique({ where: { id }, select: { id: true } })
  return exists ? 'already' : 'not-found'
}

export async function releaseHold(id: string, actorId: string, via: CallReviewVia = 'web'): Promise<ReleaseResult> {
  const res = await prisma.callRecording.updateMany({ where: { id, reviewHoldAt: { not: null } }, data: { reviewHoldAt: null, reviewHoldBy: null, reviewHoldNote: null } })
  if (res.count === 1) {
    await recordCallReviewEvent({ recordingId: id, actorId, action: 'release', via }, { always: true })
    return 'ok'
  }
  const exists = await prisma.callRecording.findUnique({ where: { id }, select: { id: true } })
  return exists ? 'not-held' : 'not-found'
}

/**
 * For a capo's list: drop the calls the private owner-only filter holds. One query for the text of the
 * page's calls. A filter that could not be read (null) drops everything (fail closed).
 */
export async function dropAutoHeld<T extends { id: string }>(rows: T[], filter: PostFilter | null): Promise<T[]> {
  if (rows.length === 0) return rows
  if (!filter) return []
  if ((filter.ownerOnlyTerms ?? []).length === 0 && (filter.ownerOnlyCrewIds ?? []).length === 0) return rows
  const texts = await prisma.callRecording.findMany({
    where: { id: { in: rows.map((r) => r.id) } },
    select: { id: true, crewId: true, title: true, summary: true, actionItems: true, chapters: true, eventName: true, crewLabel: true, transcript: true, redactedSpeakerIds: true, redactedSegmentIds: true },
  })
  const held = new Set(texts.filter((t) => autoHoldReason(t, filter) !== null).map((t) => t.id))
  return rows.filter((r) => !held.has(r.id))
}
