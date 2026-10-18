/**
 * Who may review call recordings: Dread Pizza Roberts only (Snax, 2026-10-18),
 * through the same check as L8 mission review (DPR_ONLY_MIN_LEVEL), so the two
 * can never drift apart. Fails closed on Discord lookup errors.
 */
import { NextResponse } from 'next/server'
import { canReviewMission, DPR_ONLY_MIN_LEVEL } from '@/app/lib/mission-review-access'
import { requireSession, type GuardResult } from '@/app/lib/auth-guards'

export function canReviewCalls(discordId: string): Promise<boolean> {
  return canReviewMission(discordId, DPR_ONLY_MIN_LEVEL)
}

/** 401 without a session, 403 unless Dread Pizza Roberts. */
export async function requireCallReviewer(): Promise<GuardResult> {
  const auth = await requireSession()
  if (!auth.ok) return auth
  if (!(await canReviewCalls(auth.session.discordId))) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return auth
}
