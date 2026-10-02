import { NextResponse } from "next/server";
import { getCrewMappings } from "@/app/lib/crew-mappings";
import { internalError } from "@/app/lib/errors/error-response";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    // Check for ?fresh=1 to skip cache
    const url = new URL(req.url);
    const forceRefresh = url.searchParams.get('fresh') === '1';

    const result = await getCrewMappings(forceRefresh);
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' }
    });
  } catch (err: any) {
    return internalError(err, "crew-mappings", "Failed to load crew mappings");
  }
}
