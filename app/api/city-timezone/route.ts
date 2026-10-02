import { NextResponse } from "next/server";
import { CityTimezoneError, resolveCityTimezone } from "@/app/lib/city-timezone";

export const runtime = "nodejs";

/**
 * POST /api/city-timezone (pizzaiolo-13628)
 *
 * Request:  { place_id: string }  (a Google Places ID from /api/city-autocomplete)
 * Response: { timezoneId, timezoneName, utcOffset, label }
 *
 * Logic lives in app/lib/city-timezone.ts; this route stays thin.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const result = await resolveCityTimezone(String(body?.place_id ?? ""));
    return NextResponse.json(result);
  } catch (e: unknown) {
    if (e instanceof CityTimezoneError) {
      return NextResponse.json({ error: e.message, details: e.details }, { status: e.status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}
