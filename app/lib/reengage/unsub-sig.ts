// app/lib/reengage/unsub-sig.ts
//
// Signed links for the weekly email, all HMAC-SHA256, domain-separated, keyed
// with UNSUBSCRIBE_SECRET (falls back to SESSION_SECRET, like
// app/lib/name-origin-sig.ts).
//  - unsubscribe: member id only; never expires (an old email must still work).
//  - confirm: member id + the exact address + an expiry, so a link can only
//    verify the address it was mailed to, and only for 7 days.
import { createHmac, timingSafeEqual } from "crypto";
import { SITE_URL } from "@/app/lib/site-url";

export const CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Generic building blocks, shared with the newsletter links (app/lib/newsletter/sig.ts). A payload
 * is "<domain>\n<part>\n<part>...", so a signature made for one domain never verifies in another.
 * The reengage payloads below are unchanged byte for byte (old emailed links must keep working).
 */
export function signParts(domain: string, ...parts: Array<string | number>): string | null {
  return mac([domain, ...parts].join("\n"));
}

export function sameSig(a: string, b: string): boolean {
  return same(a, b);
}

function secret(): string | null {
  return process.env.UNSUBSCRIBE_SECRET?.trim() || process.env.SESSION_SECRET?.trim() || null;
}

function mac(payload: string): string | null {
  const key = secret();
  return key ? createHmac("sha256", key).update(payload).digest("base64url") : null;
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function sign(memberId: string): string | null {
  return memberId ? signParts("reengage-unsub-v1", memberId) : null;
}

export const signUnsubscribe = sign;

export function verifyUnsubscribe(memberId: unknown, sig: unknown): boolean {
  if (typeof memberId !== "string" || typeof sig !== "string") return false;
  const expected = sign(memberId);
  return !!expected && same(sig, expected);
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

// ----- address confirmation -----

function confirmPayload(memberId: string, email: string, exp: number): string {
  return ["reengage-confirm-v1", memberId, email.trim().toLowerCase(), exp].join("\n");
}

/** Token "<exp>.<sig>" binding the member, the address and an expiry. */
export function signConfirm(memberId: string, email: string, now = Date.now()): string | null {
  const exp = now + CONFIRM_TTL_MS;
  const s = mac(confirmPayload(memberId, email, exp));
  return s ? `${exp}.${s}` : null;
}

export function verifyConfirm(memberId: unknown, email: unknown, token: unknown, now = Date.now()): boolean {
  if (typeof memberId !== "string" || typeof email !== "string" || typeof token !== "string") return false;
  const dot = token.indexOf(".");
  if (dot < 1) return false;
  const exp = Number(token.slice(0, dot));
  if (!Number.isFinite(exp) || exp < now) return false;
  const expected = mac(confirmPayload(memberId, email, exp));
  return !!expected && same(token.slice(dot + 1), expected);
}

export function confirmPageUrl(memberId: string, token: string, base = SITE_URL): string {
  return `${base}/email/confirm?m=${encodeURIComponent(memberId)}&t=${encodeURIComponent(token)}`;
}
