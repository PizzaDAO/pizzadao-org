// app/lib/newsletter/sig.ts
//
// Signed links for newsletter subscribers, keyed by subscriber id (not member id). Same HMAC key
// and helpers as the weekly digest links (app/lib/reengage/unsub-sig.ts) with their own domain
// strings, so a digest link never verifies here and the other way round.
//  - unsubscribe: "newsletter-unsub-v1\n<subscriberId>", never expires.
//  - confirm: "newsletter-confirm-v1\n<subscriberId>\n<email>\n<exp>", valid 7 days, and bound to the
//    exact address it was mailed to.
import { SITE_URL } from "@/app/lib/site-url";
import { sameSig, signParts } from "@/app/lib/reengage/unsub-sig";

export const NEWSLETTER_CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const UNSUB_DOMAIN = "newsletter-unsub-v1";
export const CONFIRM_DOMAIN = "newsletter-confirm-v1";

export function signNewsletterUnsub(subscriberId: string): string | null {
  return subscriberId ? signParts(UNSUB_DOMAIN, subscriberId) : null;
}

export function verifyNewsletterUnsub(subscriberId: unknown, sig: unknown): boolean {
  if (typeof subscriberId !== "string" || typeof sig !== "string" || !subscriberId) return false;
  const expected = signNewsletterUnsub(subscriberId);
  return !!expected && sameSig(sig, expected);
}

/** Page with the confirm button (the visible footer link). */
export function newsletterUnsubPageUrl(subscriberId: string, base = SITE_URL): string | null {
  const sig = signNewsletterUnsub(subscriberId);
  return sig ? `${base}/newsletter/unsubscribe?s=${encodeURIComponent(subscriberId)}&sig=${sig}` : null;
}

/** POST endpoint for the List-Unsubscribe header (RFC 8058 one-click). */
export function newsletterUnsubPostUrl(subscriberId: string, base = SITE_URL): string | null {
  const sig = signNewsletterUnsub(subscriberId);
  return sig ? `${base}/api/public/newsletter/unsubscribe?s=${encodeURIComponent(subscriberId)}&sig=${sig}` : null;
}

const confirmParts = (id: string, email: string, exp: number) => [id, email.trim().toLowerCase(), exp] as const;

/** Token "<exp>.<sig>" binding the subscriber, the address and an expiry. */
export function signNewsletterConfirm(subscriberId: string, email: string, now = Date.now()): string | null {
  const exp = now + NEWSLETTER_CONFIRM_TTL_MS;
  const s = signParts(CONFIRM_DOMAIN, ...confirmParts(subscriberId, email, exp));
  return s ? `${exp}.${s}` : null;
}

/** The expiry in the token when the signature is valid and not expired, else null. */
export function verifyNewsletterConfirm(subscriberId: unknown, email: unknown, token: unknown, now = Date.now()): { exp: number } | null {
  if (typeof subscriberId !== "string" || typeof email !== "string" || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const exp = Number(token.slice(0, dot));
  if (!Number.isFinite(exp) || exp < now) return null;
  const expected = signParts(CONFIRM_DOMAIN, ...confirmParts(subscriberId, email, exp));
  return expected && sameSig(token.slice(dot + 1), expected) ? { exp } : null;
}

/** When the link was issued (the token carries only the expiry). */
export const confirmIssuedAt = (exp: number) => exp - NEWSLETTER_CONFIRM_TTL_MS;

export function newsletterConfirmPageUrl(subscriberId: string, token: string, base = SITE_URL): string {
  return `${base}/newsletter/confirm?s=${encodeURIComponent(subscriberId)}&t=${encodeURIComponent(token)}`;
}
