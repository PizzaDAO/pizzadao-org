/**
 * Who may review call recordings: Dread Pizza Roberts only (Snax, 2026-10-18),
 * through isDreadPizzaRoberts, which is pinned to the role id and does NOT follow the mission
 * DPR-only level setting, so editing that setting never changes who can publish calls. Fails closed
 * on Discord lookup errors.
 */
import { NextResponse } from 'next/server'
import { isDreadPizzaRoberts } from '@/app/lib/mission-review-access'
import { requireSession, type GuardResult } from '@/app/lib/auth-guards'

export function canReviewCalls(discordId: string): Promise<boolean> {
  return isDreadPizzaRoberts(discordId)
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
