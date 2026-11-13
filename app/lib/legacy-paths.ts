/**
 * Old pizzadao.org URLs that still get requested after the move onto this app
 * (plans/pizzadao-org-to-vercel.md, Phase 3.6).
 *
 * The previous marketing site shipped a public mock "dashboard" prototype at /dashboard/<section>.
 * The real dashboard is /dashboard/[id], so those section names must be redirected before the
 * dynamic route can read them as a member id. Used by next.config.ts, which applies redirects
 * ahead of the filesystem routes. Exact /dashboard is a real page (app/dashboard/page.tsx).
 */

/** The prototype's sections (each also had detail subpaths such as /dashboard/family/<id>). */
export const LEGACY_DASHBOARD_SECTIONS = [
  "path",
  "feed",
  "events",
  "family",
  "bounties",
  "shop",
  "arcade",
  "recognition",
  "profile",
  "settings",
  "connections",
] as const;

export type LegacyRedirect = { source: string; destination: string; permanent: boolean };

/** next.config redirect rules: every prototype section (and anything below it) goes to the home page with a 308. */
export function legacyDashboardRedirects(): LegacyRedirect[] {
  return LEGACY_DASHBOARD_SECTIONS.flatMap((section) => [
    { source: `/dashboard/${section}`, destination: "/", permanent: true },
    { source: `/dashboard/${section}/:path*`, destination: "/", permanent: true },
  ]);
}
