import { GET } from "@/app/api/poaps/whitelist/route";
import { prefetchRoute } from "@/app/lib/server-prefetch";
import PoapsClient, { type WhitelistData } from "./PoapsClient";

// Rendered per request: the prefill reads live data, which must not be baked in at build time.
export const dynamic = "force-dynamic";

// The event list is cached for days, so it is loaded here (same code as /api/poaps/whitelist)
// and arrives in the first HTML.
export default async function POAPsPage() {
  const initialData = await prefetchRoute<WhitelistData>(GET, "/api/poaps/whitelist");
  return <PoapsClient initialData={initialData} />;
}
