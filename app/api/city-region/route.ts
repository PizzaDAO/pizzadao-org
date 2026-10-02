import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/app/lib/rate-limit";
import { resolveRegionFromCountryCode, getRegionRoleId } from "@/app/lib/region-mapping";
import { internalError } from "@/app/lib/errors/error-response";

export const runtime = "nodejs";

/**
 * POST /api/city-region
 *
 * Accepts a Google Places `place_id`, calls the Geocoding API to extract the
 * country code, then maps it to a PizzaDAO region and its Discord role ID.
 *
 * Request:  { place_id: string }
 * Response: { region: string, regionRoleId: string, countryCode: string }
 */
export async function POST(req: Request) {
  const limited = await enforceRateLimit(req, "city-region");
  if (limited) return limited;

  try {
    const body = await req.json();
    const placeId = String(body?.place_id ?? "").trim();

    if (!placeId) {
      return NextResponse.json({ error: "place_id is required" }, { status: 400 });
    }

    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) {
      return NextResponse.json({ error: "Missing GOOGLE_MAPS_API_KEY" }, { status: 500 });
    }

    // Call Google Geocoding API with the place_id
    const url = `https://maps.googleapis.com/maps/api/geocode/json?place_id=${encodeURIComponent(placeId)}&key=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.status !== "OK" || !data.results?.length) {
      console.error("[city-region] Geocoding error:", data.status, data.error_message);
      return NextResponse.json({ error: "Region lookup is unavailable right now" }, { status: 502 });
    }

    // Extract country code from address_components
    const components = data.results[0].address_components ?? [];
    const countryComponent = components.find((c: any) =>
      Array.isArray(c.types) && c.types.includes("country")
    );

    if (!countryComponent?.short_name) {
      return NextResponse.json(
        { error: "Could not determine country from place_id" },
        { status: 422 }
      );
    }

    const countryCode = countryComponent.short_name as string;
    const region = resolveRegionFromCountryCode(countryCode);

    if (!region) {
      return NextResponse.json(
        { region: null, regionRoleId: null, countryCode },
        { status: 200 }
      );
    }

    const regionRoleId = getRegionRoleId(region);

    return NextResponse.json({ region, regionRoleId, countryCode });
  } catch (e: unknown) {
    return internalError(e, "city-region", "Region lookup failed");
  }
}
