import { NextResponse } from "next/server";
import { CityTimezoneError, resolveCityTimezone } from "@/app/lib/city-timezone";
import { enforceRateLimit } from "@/app/lib/rate-limit";
import { internalError } from "@/app/lib/errors/error-response";

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
  const limited = await enforceRateLimit(req, "city-timezone");
  if (limited) return limited;

  try {
    const body = await req.json().catch(() => null);
    const result = await resolveCityTimezone(String(body?.place_id ?? ""));
    return NextResponse.json(result);
  } catch (e: unknown) {
    if (e instanceof CityTimezoneError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return internalError(e, "city-timezone", "Timezone lookup failed");
  }
}
