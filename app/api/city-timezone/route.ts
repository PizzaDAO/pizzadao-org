import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/city-timezone
 *
 * Accepts a Google Places `place_id`, geocodes it to get lat/lng,
 * then calls the Google Timezone API to resolve the IANA timezone.
 *
 * Request:  { place_id: string }
 * Response: { timezoneId: string, timezoneName: string, utcOffset: string, label: string }
 *
 * The `label` field is a human-friendly format like "EST (UTC-5)" suitable
 * for displaying on the crew sheet.
 */
export async function POST(req: Request) {
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

    // Step 1: Geocode the place_id to get lat/lng
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?place_id=${encodeURIComponent(placeId)}&key=${encodeURIComponent(key)}`;
    const geocodeRes = await fetch(geocodeUrl);
    const geocodeData = await geocodeRes.json();

    if (geocodeData.status !== "OK" || !geocodeData.results?.length) {
      return NextResponse.json(
        { error: `Geocoding failed: ${geocodeData.status}`, details: geocodeData.error_message ?? null },
        { status: 502 }
      );
    }

    const location = geocodeData.results[0].geometry?.location;
    if (!location?.lat || !location?.lng) {
      return NextResponse.json(
        { error: "Could not determine coordinates from place_id" },
        { status: 422 }
      );
    }

    // Step 2: Call the Google Timezone API
    // The API requires a timestamp to determine DST status — use current time
    const timestamp = Math.floor(Date.now() / 1000);
    const tzUrl = `https://maps.googleapis.com/maps/api/timezone/json?location=${location.lat},${location.lng}&timestamp=${timestamp}&key=${encodeURIComponent(key)}`;
    const tzRes = await fetch(tzUrl);
    const tzData = await tzRes.json();

    if (tzData.status !== "OK") {
      return NextResponse.json(
        { error: `Timezone API failed: ${tzData.status}`, details: tzData.errorMessage ?? null },
        { status: 502 }
      );
    }

    // tzData contains:
    //   timeZoneId: "America/New_York"
    //   timeZoneName: "Eastern Standard Time" (or "Eastern Daylight Time")
    //   rawOffset: -18000 (seconds from UTC, without DST)
    //   dstOffset: 0 or 3600 (DST offset in seconds)
    const totalOffsetSeconds = (tzData.rawOffset ?? 0) + (tzData.dstOffset ?? 0);
    const utcOffset = formatUtcOffset(totalOffsetSeconds);

    // Build abbreviation from timeZoneName (e.g., "Eastern Standard Time" -> "EST")
    const abbrev = abbreviateTimezoneName(tzData.timeZoneName ?? "");
    const label = abbrev
      ? `${abbrev} (UTC${utcOffset})`
      : `UTC${utcOffset}`;

    return NextResponse.json({
      timezoneId: tzData.timeZoneId,
      timezoneName: tzData.timeZoneName,
      utcOffset,
      label,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: (e as any)?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * Format seconds offset into a string like "+5:30" or "-5" or "+0".
 */
function formatUtcOffset(totalSeconds: number): string {
  const sign = totalSeconds >= 0 ? "+" : "-";
  const abs = Math.abs(totalSeconds);
  const hours = Math.floor(abs / 3600);
  const minutes = Math.floor((abs % 3600) / 60);
  if (minutes === 0) return `${sign}${hours}`;
  return `${sign}${hours}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Build a timezone abbreviation from a full name.
 * e.g., "Eastern Standard Time" -> "EST"
 *       "India Standard Time" -> "IST"
 *       "Australian Eastern Daylight Time" -> "AEDT"
 */
function abbreviateTimezoneName(name: string): string {
  if (!name) return "";
  // Take the first letter of each word
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length < 2) return "";
  return words.map((w) => w[0].toUpperCase()).join("");
}
