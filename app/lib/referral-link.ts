/**
 * Personal invite links (L3.1, D4): https://app.pizzadao.org/join?ref=<memberId>.
 * Pure, safe in client components.
 *
 * /join?ref=<memberId> stores the ref in the `pd_ref` cookie (httpOnly, set by
 * POST /api/referrals/ref before the Discord login), and the onboarding
 * completion (POST /api/profile) reads it to record the Referral.
 */

export const REF_COOKIE = 'pd_ref'
/** How long an invite link click is remembered (the friend may join days later). */
export const REF_COOKIE_MAX_AGE = 30 * 24 * 60 * 60

/** A member ID as it appears in the members sheet (digits), or null. */
export function normalizeRef(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : ''
  return /^\d{1,10}$/.test(s) ? s.replace(/^0+(?=\d)/, '') : null
}

export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL?.trim() || 'https://app.pizzadao.org').replace(/\/$/, '')
}

export function inviteUrl(memberId: string, base: string = appBaseUrl()): string {
  return `${base}/join?ref=${encodeURIComponent(memberId)}`
}
