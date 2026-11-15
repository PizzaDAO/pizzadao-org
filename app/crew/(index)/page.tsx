import { GET } from "@/app/api/crew/members/route";
import { prefetchRoute } from "@/app/lib/server-prefetch";
import CrewMembersClient, { type MembersResponse } from "../CrewMembersClient";

// Rendered per request: the prefill reads live data, which must not be baked in at build time.
export const dynamic = "force-dynamic";

// Page 1 of the directory is loaded here (same code as /api/crew/members) so the list is in the
// first HTML; filters, search and paging still call the API from the client.
export default async function CrewMembersPage() {
  const initialData = await prefetchRoute<MembersResponse>(GET, "/api/crew/members?page=1&limit=24");
  return <CrewMembersClient initialData={initialData} />;
}
