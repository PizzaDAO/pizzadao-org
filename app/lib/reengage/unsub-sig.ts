// app/lib/reengage/unsub-sig.ts
//
// Signed one-click unsubscribe links for the weekly re-engagement email. The
// link carries the member id and an HMAC-SHA256 of it keyed with SESSION_SECRET
// (same secret and approach as app/lib/name-origin-sig.ts), domain-separated, so
// the link needs no login and cannot be forged for another member. The signature
// never expires on purpose: an old email must still be able to unsubscribe.
import { createHmac, timingSafeEqual } from "crypto";
import { SITE_URL } from "@/app/lib/site-url";

function sign(memberId: string): string | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret || !memberId) return null;
  return createHmac("sha256", secret).update(`reengage-unsub-v1\n${memberId}`).digest("base64url");
}

export const signUnsubscribe = sign;

export function verifyUnsubscribe(memberId: unknown, sig: unknown): boolean {
  if (typeof memberId !== "string" || typeof sig !== "string") return false;
  const expected = sign(memberId);
  if (!expected) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Absolute page URL (shows a confirm button) for the visible footer link. */
export function unsubscribePageUrl(memberId: string, base = SITE_URL): string | null {
  const s = sign(memberId);
  return s ? `${base}/email/unsubscribe?m=${encodeURIComponent(memberId)}&s=${s}` : null;
}

/** Absolute POST endpoint for the List-Unsubscribe header (RFC 8058 one-click). */
export function unsubscribePostUrl(memberId: string, base = SITE_URL): string | null {
  const s = sign(memberId);
  return s ? `${base}/api/email/unsubscribe?m=${encodeURIComponent(memberId)}&s=${s}` : null;
}
