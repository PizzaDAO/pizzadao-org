import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/app/lib/rate-limit";
import { loadSettings } from "@/app/lib/settings";
import { resolveToggle } from "@/app/lib/settings/toggles";
import { upcomingEvents } from "@/app/lib/marketing/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE = "public, s-maxage=300, stale-while-revalidate=600";

/**
 * GET /api/public/calendar -> { events: [...] } for the next 60 days (the community page).
 * An empty list, never an error status, while marketing.calendarEnabled is off, no feed is set or
 * the feed cannot be read, so the page just shows its empty state.
 */
export async function GET(req: Request) {
  const limited = await enforceRateLimit(req, "marketing-calendar");
  if (limited) return limited;
  try {
    const settings = await loadSettings();
    const url = settings.get("marketing.calendarIcsUrl");
    if (!resolveToggle("marketing.calendarEnabled", settings) || !url) {
      return NextResponse.json({ events: [] }, { headers: { "Cache-Control": "public, s-maxage=60" } });
    }
    return NextResponse.json({ events: await upcomingEvents(url) }, { headers: { "Cache-Control": CACHE } });
  } catch (e) {
    console.error("[calendar] failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ events: [], warning: "unavailable" }, { headers: { "Cache-Control": "public, s-maxage=60" } });
  }
}
