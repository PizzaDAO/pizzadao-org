import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Prediction = {
  description: string;
  place_id: string;
};

export async function POST(req: Request) {
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
      return NextResponse.json(
        { error: `Places error: ${data.status}`, details: data.error_message ?? null },
        { status: 502 }
      );
    }

    const predictions: Prediction[] = (data.predictions ?? []).map((p: any) => ({
      description: p.description,
      place_id: p.place_id,
    }));

    return NextResponse.json({ predictions });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as any)?.message ?? "Unknown error" }, { status: 500 });
  }
}
