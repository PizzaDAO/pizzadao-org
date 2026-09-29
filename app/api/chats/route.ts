import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { withErrorHandling } from "@/app/lib/errors/error-response";
import { getCityChats } from "@/app/lib/chats";

export const runtime = "nodejs";

// GET /api/chats - Telegram chat directory (logged-in members only)
const GET_HANDLER = async () => {
  const session = await getSession();
  if (!session?.discordId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const cities = await getCityChats();

  // List payload omits chatUrl; cards link through /chats/{slug}.
  const list = cities.map(({ slug, name, country, region, isSupergroup }) => ({
    slug,
    name,
    country,
    region,
    isSupergroup,
  }));

  // Distinct non-null region slugs with counts, sorted by count desc.
  const regionCounts = new Map<string, number>();
  for (const c of cities) {
    if (!c.region) continue;
    regionCounts.set(c.region, (regionCounts.get(c.region) ?? 0) + 1);
  }
  const regions = [...regionCounts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json(
    { cities: list, regions },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
};

export const GET = withErrorHandling(GET_HANDLER);
