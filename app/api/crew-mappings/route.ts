import { NextResponse } from "next/server";
import { getCrewMappings } from "@/app/lib/crew-mappings";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    // Check for ?fresh=1 to skip cache
    const url = new URL(req.url);
    const forceRefresh = url.searchParams.get('fresh') === '1';

    const result = await getCrewMappings(forceRefresh);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message ?? "Unknown error") }, { status: 500 });
  }
}
