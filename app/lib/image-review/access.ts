/**
 * Who may use the image review: Pizza Capo role holders and Dread Pizza Roberts (the owner) at any
 * level, plus members who have completed at least imageReview.minCompletedLevel (default 2).
 * Independent of the calls.capoReviewEnabled toggle. Fails closed on lookup errors: an unreadable
 * level counts as nothing completed. The CSV/JSON export is owner-only.
 */
import { NextResponse } from 'next/server'
import { holdsAny, isDreadPizzaRoberts, resolveRoles } from '@/app/lib/mission-review-access'
import { requireSession } from '@/app/lib/auth-guards'
import { getSetting } from '@/app/lib/settings'
import { getCurrentLevel } from '@/app/lib/missions'
import { completedLevel } from '@/app/lib/level-display'
import type { Session } from '@/app/lib/session'
import { CALL_CAPO_ROLE_IDS } from '@/app/ui/constants'

export type ImageReviewRole = 'owner' | 'capo' | 'member'

export type ImageReviewAccessInfo = {
  role: ImageReviewRole | null
  /** Highest completed level; 0 when unreadable, -1 when not checked (capo/owner). */
  completed: number
  minLevel: number
}

/** Role plus the level numbers a denied screen shows. Never throws. */
export async function imageReviewAccess(discordId: string): Promise<ImageReviewAccessInfo> {
  const minLevel = await getSetting('imageReview.minCompletedLevel').catch(() => 2)
  try {
    if (await isDreadPizzaRoberts(discordId)) return { role: 'owner', completed: -1, minLevel }
    if (await holdsAny(await resolveRoles(discordId), CALL_CAPO_ROLE_IDS)) return { role: 'capo', completed: -1, minLevel }
  } catch {
    // Role lookup failed: fall through to the level check, which can still admit a member.
  }
  const completed = await getCurrentLevel(discordId).then(completedLevel).catch(() => 0)
  return { role: completed >= minLevel ? 'member' : null, completed, minLevel }
}

export async function imageReviewRole(discordId: string): Promise<ImageReviewRole | null> {
  return (await imageReviewAccess(discordId)).role
}

export type ImageReviewAccess =
  | { ok: true; session: Session; role: ImageReviewRole }
  | { ok: false; response: NextResponse }

/** 401 without a session, 403 unless allowed (or, with ownerOnly, unless owner). */
export async function requireImageReviewer(opts: { ownerOnly?: boolean } = {}): Promise<ImageReviewAccess> {
  const auth = await requireSession()
  if (!auth.ok) return auth
  const role = await imageReviewRole(auth.session.discordId)
  if (!role || (opts.ownerOnly && role !== 'owner')) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ok: true, session: auth.session, role }
}
