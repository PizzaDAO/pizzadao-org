/**
 * The marketing pages (about, partners, community, brand-system, contact, privacy, terms and the
 * home page) that live in app/(marketing) (plans/pizzadao-org-to-vercel.md, Phase 2).
 *
 * Two build-time switches, both off by default, so deploying this changes nothing for search engines
 * or for the wizard at "/":
 *
 *   NEXT_PUBLIC_MARKETING_INDEXABLE=1     the pages drop their noindex tag and join sitemap.xml
 *   NEXT_PUBLIC_MARKETING_HOME_AT_ROOT=1  "/" serves the marketing home page (the wizard stays at /start)
 *
 * They are NEXT_PUBLIC_ so the server, the middleware-free rewrite in next.config.ts and the client
 * header all read the same value. Each must be written as a literal `process.env.NAME` so Next can
 * inline it; the values are fixed at build time, which fits a cutover that ships as a deploy.
 */
import type { Metadata } from "next";

/** Marketing routes other than "/" itself. "/home" is the home page's own path until it takes over "/". */
export const MARKETING_PATHS = ["/about", "/partners", "/community", "/brand-system", "/contact", "/privacy", "/terms", "/home"] as const;

/** Marketing routes that go in sitemap.xml once indexable ("/" is already listed there). */
export const MARKETING_SITEMAP_PATHS = ["/about", "/partners", "/community", "/brand-system", "/contact", "/privacy", "/terms"] as const;

const ON_WORDS = ["1", "true", "on", "yes"];
const isOn = (raw: string | undefined) => ON_WORDS.includes((raw ?? "").trim().toLowerCase());

export function marketingIndexable(): boolean {
  return isOn(process.env.NEXT_PUBLIC_MARKETING_INDEXABLE);
}

export function marketingHomeAtRoot(): boolean {
  return isOn(process.env.NEXT_PUBLIC_MARKETING_HOME_AT_ROOT);
}

/** Whether a pathname is rendered by the marketing layout (the app header and corner links hide there). */
export function isMarketingPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  if (pathname === "/") return marketingHomeAtRoot();
  return MARKETING_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** The robots meta for every marketing page: noindex until the cutover switch is on. */
export function marketingRobots(): NonNullable<Metadata["robots"]> {
  return marketingIndexable() ? { index: true, follow: true } : { index: false, follow: false };
}
