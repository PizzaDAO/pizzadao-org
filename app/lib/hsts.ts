/**
 * Strict-Transport-Security value for the app's responses (plans/pizzadao-org-to-vercel.md, Phase 3.5).
 *
 * `includeSubDomains` is only safe while the app is served from a subdomain. Served from the
 * apex it would force HTTPS on every *.pizzadao.org host for two years (mail tracking and other
 * hosts have not all been checked), so it is dropped when the site origin is the registrable apex.
 */
const MAX_AGE = "max-age=63072000";

/** True when `hostname` is a bare registrable domain such as pizzadao.org (no subdomain label). */
function isApex(hostname: string): boolean {
  return hostname.split(".").length <= 2;
}

export function hstsHeaderValue(siteUrl: string): string {
  try {
    return isApex(new URL(siteUrl).hostname) ? MAX_AGE : `${MAX_AGE}; includeSubDomains`;
  } catch {
    return `${MAX_AGE}; includeSubDomains`;
  }
}
