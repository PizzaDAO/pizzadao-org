// Top-level message namespaces that client components read through useTranslations().
// The root layout sends only these to NextIntlClientProvider instead of the whole catalog (server
// components keep using getTranslations, which reads the full catalog on the server).
//
// Add a namespace here when a client component starts using a new one: the test in
// __tests__/client-namespaces.test.ts fails if a file calls useTranslations() with a namespace
// that is missing from this list.
export const CLIENT_NAMESPACES = [
  "adminCalls",
  "bounties",
  "buddyCard",
  "callsPage",
  "collectPep",
  "collectionStats",
  "eventsAttended",
  "common",
  "communityTerms",
  "crewBounties",
  "crewCallUpdates",
  "crewDrafts",
  "crewGettingStarted",
  "crewPage",
  "crewsPage",
  "dashboard",
  "disavow",
  "discordActivity",
  "laneCard",
  "discordActivity",
  "language",
  "memberCard",
  "memberSince",
  "missionHold",
  "missionLinks",
  "nav",
  "onboarding",
  "passport",
  "payments",
  "profileEdit",
  "profileShare",
  "proposals",
  "reengage",
  "reminders",
  "slices",
  "spotlight",
  "taxForm",
  "telegramLink",
  "trivia",
] as const;

/** The subset of a catalog that client components may read. Unknown namespaces are simply absent. */
export function pickClientMessages<T extends Record<string, unknown>>(messages: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const ns of CLIENT_NAMESPACES) {
    if (ns in messages) out[ns] = messages[ns];
  }
  return out as Partial<T>;
}
