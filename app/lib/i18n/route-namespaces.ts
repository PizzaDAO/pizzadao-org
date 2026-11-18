// Which message namespaces each part of the app sends to the browser.
//
// Server components read the full catalog through getTranslations(); only client components
// (useTranslations) need messages in the page payload. The root layout sends ROOT_NAMESPACES (what
// the shared chrome uses). A route segment that needs more wraps its children in <RouteMessages
// route="...">, which sends ROOT_NAMESPACES plus ROUTE_NAMESPACES[route] (nested next-intl
// providers replace, not merge, their parent's messages, so the root picks are repeated).
//
// The guard test in __tests__/route-namespaces.test.ts walks the import graph of every route and
// fails when a client component uses a namespace its route does not supply, or when an entry here
// is no longer used. Entries are dotted catalog paths ("proposals.banner" or a whole namespace).

/** Used by the root layout's own chrome (SiteHeader, MagicLoginLandedNotice, GlobalBallotPreparer). */
export const ROOT_NAMESPACES = ["nav", "proposals.banner", "onboarding.magicLogin"] as const;

/** Keyed by top-level app segment ("" is app/page.tsx). Segments absent here need only the root picks. */
export const ROUTE_NAMESPACES: Record<string, readonly string[]> = {
  "": ["onboarding"],
  admin: ["adminCalls", "crewCallUpdates"],
  calls: ["callsPage", "memberCard", "memberSince", "discordActivity"],
  crew: ["crewPage", "crewCallUpdates", "crewDrafts", "crewBounties", "crewGettingStarted"],
  crews: ["crewsPage"],
  dashboard: [
    "language",
    "dashboard",
    "laneCard",
    "buddyCard",
    "slices",
    "collectPep",
    "memberCard",
    "memberSince",
    "discordActivity",
    "common",
    "missionHold",
    "missionLinks",
    "callsPage",
  ],
  "get-your-mafia-name": ["onboarding"],
  join: ["onboarding"],
  login: ["onboarding"],
  missions: ["missionLinks", "dashboard", "missionHold", "communityTerms"],
  passport: ["passport"],
  payments: ["payments"],
  pep: ["memberCard", "memberSince", "discordActivity", "bounties", "collectPep", "communityTerms"],
  poaps: ["communityTerms"],
  profile: [
    "eventsAttended",
    "collectionStats",
    "passport",
    "dashboard",
    "memberSince",
    "profileShare",
    "discordActivity",
    "profileEdit",
    "language",
    "reminders",
    "reengage",
    "common",
    "telegramLink",
  ],
  proposals: ["proposals", "reminders"],
  slices: ["slices"],
  spotlight: ["spotlight"],
  start: ["onboarding"],
  "tax-form": ["taxForm"],
  trivia: ["trivia"],
};

/** Segments whose layout loads its own catalog instead of using RouteMessages (so nobody else receives it). */
export const OWN_CATALOG_SEGMENTS: Record<string, readonly string[]> = { disavow: ["disavow"] };

/** Dotted catalog paths a route's provider supplies: the root picks plus the route's own. */
export function routeMessagePaths(route: string): string[] {
  return [...new Set<string>([...ROOT_NAMESPACES, ...(ROUTE_NAMESPACES[route] ?? [])])];
}

/**
 * Builds a catalog containing only the given dotted paths ("nav", "proposals.banner"). A path that
 * is not in the catalog is skipped. A whole namespace wins over a deeper path inside it.
 */
export function pickMessages(messages: Record<string, unknown>, paths: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const sorted = [...new Set(paths)].sort((a, b) => a.split(".").length - b.split(".").length);
  const taken: string[] = [];
  for (const p of sorted) {
    if (taken.some((t) => p === t || p.startsWith(`${t}.`))) continue;
    const parts = p.split(".");
    let src: unknown = messages;
    for (const k of parts) {
      src = src && typeof src === "object" ? (src as Record<string, unknown>)[k] : undefined;
    }
    if (src === undefined) continue;
    let dst = out;
    for (const k of parts.slice(0, -1)) {
      const next = dst[k];
      dst = (dst[k] = next && typeof next === "object" ? next : {}) as Record<string, unknown>;
    }
    dst[parts[parts.length - 1]] = src;
    taken.push(p);
  }
  return out;
}
