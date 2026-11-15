import { GET } from "@/app/api/manuals/route";
import { prefetchRoute } from "@/app/lib/server-prefetch";
import ManualsClient, { type ManualsResponse } from "./ManualsClient";

// Rendered per request: the prefill reads live data, which must not be baked in at build time.
export const dynamic = "force-dynamic";

// The manual index is loaded here (same code as /api/manuals) so the list is in the first HTML.
export default async function ManualsPage() {
  const initialData = await prefetchRoute<ManualsResponse>(GET, "/api/manuals");
  return <ManualsClient initialData={initialData} />;
}
