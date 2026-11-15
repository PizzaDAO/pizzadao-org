import { GET } from "@/app/api/calls/route";
import { prefetchRoute } from "@/app/lib/server-prefetch";
import CallsClient, { type CallsResponse } from "../CallsClient";

// Rendered per request: the prefill reads live data, which must not be baked in at build time.
export const dynamic = "force-dynamic";

// The first page of calls is loaded here (same code as /api/calls) so the list is in the first
// HTML; filters, sorting and paging still call the API from the client.
export default async function CallsPage() {
  const initialData = await prefetchRoute<CallsResponse>(GET, "/api/calls?page=1&limit=20");
  return <CallsClient initialData={initialData} />;
}
