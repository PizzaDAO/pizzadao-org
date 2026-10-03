/**
 * The invite-link cookie (`pd_ref`): set by POST /api/referrals/ref when
 * someone opens /join?ref=<memberId>, before the Discord login; read and
 * cleared by POST /api/profile when onboarding completes.
 */
import { REF_COOKIE, REF_COOKIE_MAX_AGE, normalizeRef } from './referral-link'
import { readCookie } from './oauth-proxy'

export function refCookieOptions(req?: Request, maxAge: number = REF_COOKIE_MAX_AGE) {
  const isHttp = req ? new URL(req.url).protocol === 'http:' : false
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || !isHttp,
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  }
}

export function readRefCookie(req: Request): string | null {
  return normalizeRef(readCookie(req, REF_COOKIE))
}

export { REF_COOKIE }
