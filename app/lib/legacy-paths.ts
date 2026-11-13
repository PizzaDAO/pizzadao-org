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

/**
 * Old public asset URLs whose files now live only under /marketing (same bytes, or a compressed
 * copy). Redirected instead of duplicated in public/.
 */
export const LEGACY_ASSET_PATHS = [
  "/brand-kit/stickers/molto-benny-sticker.ai",
  "/brand-kit/stickers/molto-benny-sticker.pdf",
  "/media/community-japan.jpg",
  "/media/nyc-rp-teaser-poster.jpg",
  "/media/wen-pizza-nyc-poster.jpg",
] as const;

/** next.config redirect rules: each old asset URL goes to its /marketing copy with a 308. */
export function legacyAssetRedirects(): LegacyRedirect[] {
  return LEGACY_ASSET_PATHS.map((path) => ({ source: path, destination: `/marketing${path}`, permanent: true }));
}
