// Canonical public origin of the member site, used for metadataBase,
// sitemap.xml and robots.txt. Override per-environment with
// NEXT_PUBLIC_APP_URL / NEXT_PUBLIC_SITE_URL.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  "https://pizzadao.org"
).replace(/\/$/, "");
