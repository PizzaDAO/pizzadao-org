import { NextResponse } from "next/server";

export const runtime = "nodejs";

function clampStr(s: unknown, max: number) {
  const t = String(s ?? "").trim().replace(/\s+/g, " ");
  return t.length > max ? t.slice(0, max) : t;
}

export async function POST(req: Request) {
  try {
    const url = process.env.GOOGLE_SHEETS_WEBAPP_URL;
    const secret = process.env.GOOGLE_SHEETS_SHARED_SECRET;
    if (!url || !secret) {
      return NextResponse.json({ error: "Missing Sheets webapp env vars" }, { status: 500 });
    }

    const body = await req.json();

    const payload = {
      secret,
      source: clampStr(body.source ?? "web", 20),
      sessionId: clampStr(body.sessionId ?? "", 80),

      mafiaName: clampStr(body.mafiaName, 64),
      topping: clampStr(body.topping, 50),

      mafiaMovieTitle: clampStr(body.mafiaMovieTitle, 120),
      resolvedMovieTitle: clampStr(body.resolvedMovieTitle, 120),
      tmdbMovieId: clampStr(body.tmdbMovieId, 30),
      releaseDate: clampStr(body.releaseDate, 20),

      city: clampStr(body.city, 120),
      turtle: clampStr(body.turtle, 40),
      crews: Array.isArray(body.crews) ? body.crews.map((x: any) => clampStr(x, 40)) : [],
    };

    // Basic validation
    if (!payload.mafiaName || !payload.topping || !payload.mafiaMovieTitle || !payload.city || !payload.turtle) {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Apps Script should return JSON; if not, include raw
    }

    if (!res.ok || parsed?.ok === false) {
      return NextResponse.json(
        { error: "Failed to write to Google Sheet", details: parsed ?? text },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
  }
}
