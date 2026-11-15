import { GET } from "@/app/api/poaps/whitelist/route";
import { prefetchRoute } from "@/app/lib/server-prefetch";
import PoapsClient, { type WhitelistData } from "./PoapsClient";

// Rendered per request: the prefill reads live data, which must not be baked in at build time.
export const dynamic = "force-dynamic";

// The event list is cached for days, so it is loaded here (same code as /api/poaps/whitelist)
// and arrives in the first HTML.
export default async function POAPsPage() {
  const raw = await prefetchRoute<WhitelistData & { debug?: unknown }>(GET, "/api/poaps/whitelist");
  // Drop the route's debug payload so it never reaches the page.
  const initialData = raw ? { events: raw.events, totalCount: raw.totalCount, fromCache: raw.fromCache } : null;
  return <PoapsClient initialData={initialData} />;
}
