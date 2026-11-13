/**
 * Session bridge (plans/pizzadao-org-to-vercel.md, Phase 3.4, decision 6): a signed-in member who
 * opens an old app.pizzadao.org page is redirected to the main site WITH their login, so nobody
 * has to sign in again after the move. Behind the site.sessionBridgeEnabled switch (off by default).
 *
 * Flow:
 *   1. The legacy host (proxy.ts) sees a valid session cookie on a page request that it is about
 *      to redirect. It mints a transfer token (createTransferToken, 60 s, origin = main site,
 *      random jti) and a matching cookie, and redirects to
 *      <site>/api/auth/session-transfer?token=...&next=<path>.
 *   2. session-transfer (on the main site) checks the signature, expiry, origin, that the jti cookie
 *      matches the token, and that the jti was never used; it then sets the session cookie and
 *      redirects to the validated local `next` path.
 *
 * Why it is safe:
 *   - The token is short-lived, signed and spent once (the jti is recorded in ConsumedToken).
 *   - It is bound to the browser that asked: the jti also travels in an httpOnly cookie scoped to
 *     the session-transfer path. An attacker who feeds a victim a link with the attacker's own
 *     token (login CSRF) cannot set that cookie in the victim's browser. This assumes every
 *     *.pizzadao.org subdomain is trusted, since any of them can set a Domain=pizzadao.org cookie
 *     (notify. is delegated to a third party: keep it that way only while that holds).
 *   - On production, session-transfer refuses tokens WITHOUT a jti (those are the preview OAuth
 *     proxy's), and honours `next` only for bridge tokens, so a forged plain token cannot log a
 *     victim in as someone else.
 *   - `next` is a local path only (loginReturnPath), never a URL, so it cannot redirect off-site.
 *   - Tokens are never logged; the redirects carry no-store and no-referrer.
 */
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { createTransferToken } from "./oauth-proxy";
import { loginReturnPath } from "./login-return";
import type { Session } from "./session";
import { SITE_URL } from "./site-url";

export const BRIDGE_COOKIE = "pd_bridge";
export const BRIDGE_PATH = "/api/auth/session-transfer";
export const BRIDGE_COOKIE_MAX_AGE_SECONDS = 120;
/** ConsumedToken.pollId used for spent bridge tokens. */
export const BRIDGE_CONSUMED_KIND = "session-bridge";

/** Cookie options for the jti cookie: shared with the main site through the Domain attribute, but only sent to the transfer endpoint. */
export function bridgeCookieOptions(siteUrl: string = SITE_URL) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: BRIDGE_PATH,
    domain: new URL(siteUrl).hostname,
    maxAge: BRIDGE_COOKIE_MAX_AGE_SECONDS,
  };
}

/** True for requests that must not spend a login handover (router prefetches and RSC fetches). */
export function isPrefetchLike(headers: Pick<Headers, "get">): boolean {
  const flag = (name: string) => headers.get(name) !== null;
  return (
    flag("next-router-prefetch") ||
    flag("rsc") ||
    /prefetch/i.test(headers.get("purpose") ?? "") ||
    /prefetch/i.test(headers.get("sec-purpose") ?? "")
  );
}

export interface Bridge {
  /** Absolute URL on the main site's transfer endpoint. */
  url: string;
  /** Value of the BRIDGE_COOKIE to set alongside the redirect. */
  jti: string;
}

/**
 * Mint the handover for `session`, landing on `nextPath` (path + query on the main site).
 * Null when there is nothing safe to hand over (no usable path or session).
 */
export function mintBridge(session: Session, nextPath: string, siteUrl: string = SITE_URL): Bridge | null {
  if (!session.discordId) return null;
  const next = loginReturnPath(nextPath);
  if (!next) return null;
  const jti = randomBytes(18).toString("base64url");
  const origin = new URL(siteUrl).origin;
  const token = createTransferToken({
    discordId: session.discordId,
    username: session.username ?? "",
    nick: session.nick ?? "",
    origin,
    jti,
  });
  const url = new URL(BRIDGE_PATH, origin);
  url.searchParams.set("token", token);
  url.searchParams.set("next", next);
  return { url: url.toString(), jti };
}

/** Constant-time check that the cookie holds the token's jti. */
export function bridgeCookieMatches(cookieJti: string | undefined, tokenJti: string | undefined): boolean {
  if (!cookieJti || !tokenJti) return false;
  const a = Buffer.from(cookieJti);
  const b = Buffer.from(tokenJti);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function bridgeTokenHash(jti: string): string {
  return createHash("sha256").update("bridge:" + jti).digest("hex");
}

/** Headers for every response that carries a token or a handover cookie. */
export const BRIDGE_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
} as const;
