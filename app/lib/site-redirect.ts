/**
 * Old app host -> main site redirect (plans/pizzadao-org-to-vercel.md, Phase 3.3 and 3.4).
 *
 * Pure helpers used by proxy.ts. The redirect only ever applies when the request host is the
 * legacy app host AND this build's SITE_URL is some other origin (the apex): a build that still
 * has the old env never redirects, so shipping this changes nothing before the cutover. It is
 * further behind the site.hostRedirectEnabled switch (off by default).
 *
 * /api/*, /_next/*, /_vercel/* and /.well-known/* are never redirected: webhooks (Discord,
 * Telegram, RSVPizza), one-click unsubscribe POSTs in old emails, the recorder, pizza-radio and
 * open tabs loading chunks all keep working on the old host.
 */
import { LEGACY_APP_HOST, SITE_URL } from "./site-url";

/** Where the old host's "/" goes: the onboarding wizard's new home (the apex serves the marketing home at "/"). */
export const ROOT_REDIRECT_PATH = "/start";

/** Path prefixes that are served as they are on the old host, forever. */
const NEVER_REDIRECT = /^\/(?:api|_next|_vercel|\.well-known)(?:\/|$)/;

/** Host header value to a bare lowercase hostname (no port, no trailing dot). */
function bareHost(host: string | null | undefined): string {
  return (host ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

/** Origin of `siteUrl`, or null when it does not parse. */
function originOf(siteUrl: string): string | null {
  try {
    return new URL(siteUrl).origin;
  } catch {
    return null;
  }
}

/** True when a request on `host` is on the old host and this build's site origin is a different one. */
export function onLegacyHost(host: string | null | undefined, siteUrl: string = SITE_URL): boolean {
  if (bareHost(host) !== LEGACY_APP_HOST) return false;
  try {
    return new URL(siteUrl).hostname !== LEGACY_APP_HOST;
  } catch {
    return false;
  }
}

export function isExcludedFromHostRedirect(pathname: string): boolean {
  return NEVER_REDIRECT.test(pathname);
}

/**
 * The page path (with query) a legacy-host request maps to on the main site: "/" becomes
 * ROOT_REDIRECT_PATH, everything else is path for path. Always starts with exactly one "/",
 * so it can never be read as a protocol-relative URL.
 */
export function mappedPath(pathname: string, search: string): string {
  const path = pathname === "/" || pathname === "" ? ROOT_REDIRECT_PATH : pathname;
  return "/" + path.replace(/^[/\\]+/, "") + search;
}

/** Absolute redirect target on the main site, or null when it cannot be built safely. */
export function hostRedirectTarget(pathname: string, search: string, siteUrl: string = SITE_URL): string | null {
  const origin = originOf(siteUrl);
  if (!origin) return null;
  const target = origin + mappedPath(pathname, search);
  try {
    // Belt and braces: whatever the path held, the result must still be on the main site.
    return new URL(target).origin === origin ? target : null;
  } catch {
    return null;
  }
}
