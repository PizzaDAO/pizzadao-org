import { NextResponse } from "next/server";
import { getCrewMappings } from "@/app/lib/crew-mappings";
import { internalError } from "@/app/lib/errors/error-response";
import { realCrews } from "@/app/lib/crew-id";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    // Check for ?fresh=1 to skip cache
    const url = new URL(req.url);
    const forceRefresh = url.searchParams.get('fresh') === '1';
    // Crew lists and pickers only see real crews; ?all=1 also returns entries that are calls, not crews (the Community Call).
    const all = url.searchParams.get('all') === '1';

    const result = await getCrewMappings(forceRefresh);
    const body = all ? result : { ...result, crews: realCrews(result.crews) };
    return NextResponse.json(body, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' }
    });
  } catch (err: any) {
    return internalError(err, "crew-mappings", "Failed to load crew mappings");
  }
}
