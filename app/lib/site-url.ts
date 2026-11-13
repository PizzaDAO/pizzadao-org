// Canonical public origin of the member app (pizzadao.org itself is the
// separate marketing site), used for metadataBase, sitemap.xml, robots.txt
// and the links the bots and emails send. Override per-environment with
// NEXT_PUBLIC_APP_URL / NEXT_PUBLIC_SITE_URL.
export const LEGACY_APP_ORIGIN = "https://app.pizzadao.org";
export const LEGACY_APP_HOST = "app.pizzadao.org";

export const SITE_URL = (
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  LEGACY_APP_ORIGIN
).replace(/\/$/, "");

/** SITE_URL without the scheme (for copy that shows a bare host, e.g. "pizzadao.org"). */
export const SITE_HOST = SITE_URL.replace(/^https?:\/\//, "");
