import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/app/lib/rate-limit";
import { internalError } from "@/app/lib/errors/error-response";

export const runtime = "nodejs";

type Prediction = {
  description: string;
  place_id: string;
};

export async function POST(req: Request) {
  const limited = await enforceRateLimit(req, "city-autocomplete");
  if (limited) return limited;

  try {
    const { input } = await req.json();

    const q = String(input ?? "").trim();
    if (q.length < 2) return NextResponse.json({ predictions: [] });

    const key = process.env.GOOGLE_MAPS_API_KEY;
    if (!key) return NextResponse.json({ error: "Missing GOOGLE_MAPS_API_KEY" }, { status: 500 });

    // Places Autocomplete (legacy endpoint). Works well for city-like queries.
    // You can bias to cities using types=(cities)
    const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
    url.searchParams.set("input", q);
    url.searchParams.set("types", "(cities)");
    url.searchParams.set("language", "en");
    url.searchParams.set("key", key);

    const res = await fetch(url.toString());
    const data = await res.json();

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      console.error("[city-autocomplete] Places error:", data.status, data.error_message);
      return NextResponse.json({ error: "City search is unavailable right now" }, { status: 502 });
    }

    const predictions: Prediction[] = (data.predictions ?? []).map((p: any) => ({
      description: p.description,
      place_id: p.place_id,
    }));

    return NextResponse.json({ predictions });
  } catch (e: unknown) {
    return internalError(e, "city-autocomplete", "City search failed");
  }
}
