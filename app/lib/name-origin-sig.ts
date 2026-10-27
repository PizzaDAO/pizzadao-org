// app/lib/name-origin-sig.ts
//
// Server-side proof that a mafia name (and its origin line) was actually offered
// by /api/namegen. namegen signs each suggestion; the claim route only keeps the
// origin, and only makes /made/[id] public, when the signature verifies. Without
// it a member could publish arbitrary text on a public page. HMAC-SHA256 keyed
// with SESSION_SECRET (the app's existing server secret), domain-separated.
import { createHmac, timingSafeEqual } from "crypto";
import type { NameOriginWithFilm } from "./name-origin";

function sign(name: string, o: NameOriginWithFilm): string | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  return createHmac("sha256", secret)
    .update(`mafia-name-origin\n${name}|${o.kind}|${o.person}|${o.film}`)
    .digest("base64url");
}

export const signNameOrigin = sign;

export function verifyNameOrigin(name: string, o: NameOriginWithFilm, sig: unknown): boolean {
  if (typeof sig !== "string") return false;
  const expected = sign(name, o);
  if (!expected) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
