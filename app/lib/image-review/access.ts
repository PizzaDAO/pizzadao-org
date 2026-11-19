/**
 * Who may use the capo image review: Pizza Capo role holders and Dread Pizza Roberts (the owner).
 * Independent of the calls.capoReviewEnabled toggle. Fails closed on lookup errors.
 * The CSV/JSON export is owner-only.
 */
import { NextResponse } from 'next/server'
import { holdsAny, isDreadPizzaRoberts, resolveRoles } from '@/app/lib/mission-review-access'
import { requireSession } from '@/app/lib/auth-guards'
import type { Session } from '@/app/lib/session'
import { CALL_CAPO_ROLE_IDS } from '@/app/ui/constants'

export type ImageReviewRole = 'owner' | 'capo'

export async function imageReviewRole(discordId: string): Promise<ImageReviewRole | null> {
  try {
    if (await isDreadPizzaRoberts(discordId)) return 'owner'
    return (await holdsAny(await resolveRoles(discordId), CALL_CAPO_ROLE_IDS)) ? 'capo' : null
  } catch {
    return null
  }
}

export type ImageReviewAccess =
  | { ok: true; session: Session; role: ImageReviewRole }
  | { ok: false; response: NextResponse }

/** 401 without a session, 403 unless capo or owner (or, with ownerOnly, unless owner). */
export async function requireImageReviewer(opts: { ownerOnly?: boolean } = {}): Promise<ImageReviewAccess> {
  const auth = await requireSession()
  if (!auth.ok) return auth
  const role = await imageReviewRole(auth.session.discordId)
  if (!role || (opts.ownerOnly && role !== 'owner')) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ok: true, session: auth.session, role }
}
