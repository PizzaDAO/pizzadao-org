/**
 * The chosen-lane cookie (`pd_lane`), the same pattern as the invite-link `pd_ref` cookie: set by
 * POST /api/lanes/intent when a visitor opens /join?lane=<slug> (before the Discord login), read and
 * cleared by POST /api/profile when onboarding completes. It is only a hint: the server re-checks
 * that the lane is published and the setting is on before acting on it.
 */
import { readCookie } from '@/app/lib/oauth-proxy'
import { refCookieOptions } from '@/app/lib/referral-cookie'
import { isLaneSlug } from './links'

export const LANE_COOKIE = 'pd_lane'
/** How long a lane pick is remembered across the login round trip (short: it is a same-session intent). */
export const LANE_COOKIE_MAX_AGE = 3 * 24 * 60 * 60

/** A lane slug exactly as stored (lower-case letters, digits, dashes), or null. */
export function normalizeLaneSlug(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : ''
  return isLaneSlug(s) ? s : null
}

export function readLaneCookie(req: Request): string | null {
  return normalizeLaneSlug(readCookie(req, LANE_COOKIE))
}

export function laneCookieOptions(req?: Request, maxAge: number = LANE_COOKIE_MAX_AGE) {
  return refCookieOptions(req, maxAge)
}
