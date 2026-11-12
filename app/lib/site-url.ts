// Canonical public origin of the member app (pizzadao.org itself is the
// separate marketing site), used for metadataBase, sitemap.xml, robots.txt
// and the links the bots and emails send. Override per-environment with
// NEXT_PUBLIC_APP_URL / NEXT_PUBLIC_SITE_URL.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://app.pizzadao.org"
).replace(/\/$/, "");
