/**
 * Who may do what in the meme folder (bellpepper-80127).
 *
 *  - View: any signed-in member, while memes.enabled is on (off: every route answers 404).
 *  - Upload: a member who has completed at least memes.minCompletedLevel (default 1) and is not on
 *    the disavow list. An unreadable level counts as nothing completed; an unreadable disavow
 *    lookup counts as listed (both fail closed).
 *  - Review (approve, reject, hide, restore, see waiting files): Pizza Capo role holders and Dread
 *    Pizza Roberts. A role lookup failure means "not a reviewer".
 */
import { NextResponse } from 'next/server'
import { requireSession } from '@/app/lib/auth-guards'
import { getSetting } from '@/app/lib/settings'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { holdsAny, resolveRoles } from '@/app/lib/mission-review-access'
import { getCurrentLevel } from '@/app/lib/missions'
import { completedLevel } from '@/app/lib/level-display'
import { isDisavowSubject } from '@/app/lib/disavow/access'
import type { Session } from '@/app/lib/session'
import { CALL_CAPO_ROLE_IDS, DREAD_PIZZA_ROBERTS_ROLE_ID } from '@/app/ui/constants'

export function memesEnabled(): Promise<boolean> {
  return toggleEnabled('memes.enabled').catch(() => false)
}

export function notAvailable(): NextResponse {
  return NextResponse.json({ error: 'Not available' }, { status: 404 })
}

/** Capo or Dread Pizza Roberts (one role lookup). Fails closed. */
export async function isMemeReviewer(discordId: string): Promise<boolean> {
  try {
    return await holdsAny(await resolveRoles(discordId), [DREAD_PIZZA_ROBERTS_ROLE_ID, ...CALL_CAPO_ROLE_IDS])
  } catch {
    return false
  }
}

export type UploadEligibility = { ok: true } | { ok: false; reason: 'level' | 'disavowed'; minLevel: number; completed: number }

export async function uploadEligibility(discordId: string): Promise<UploadEligibility> {
  const minLevel = await getSetting('memes.minCompletedLevel').catch(() => 1)
  const disavowed = await isDisavowSubject(discordId).catch(() => true)
  if (disavowed) return { ok: false, reason: 'disavowed', minLevel, completed: 0 }
  if (minLevel <= 0) return { ok: true }
  const completed = await getCurrentLevel(discordId).then(completedLevel).catch(() => 0)
  return completed >= minLevel ? { ok: true } : { ok: false, reason: 'level', minLevel, completed }
}

export type MemeGuard = { ok: true; session: Session } | { ok: false; response: NextResponse }

/** 401 without a session, 404 while the feature is off. */
export async function requireMemeMember(): Promise<MemeGuard> {
  const auth = await requireSession()
  if (!auth.ok) return auth
  if (!(await memesEnabled())) return { ok: false, response: notAvailable() }
  return auth
}

/** Like requireMemeMember, plus 403 unless the member is a capo or DPR. */
export async function requireMemeReviewer(): Promise<MemeGuard> {
  const auth = await requireMemeMember()
  if (!auth.ok) return auth
  if (!(await isMemeReviewer(auth.session.discordId))) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return auth
}
