import { NextResponse } from "next/server";
import { toggleEnabled } from "@/app/lib/settings/toggles";

export const runtime = "nodejs";

/**
 * The logged-out answer of /api/session, for visitors the browser already knows are signed out.
 * It NEVER reads cookies or headers, so the response cannot vary per visitor and is safe to cache
 * on the CDN. (Do not add getSession(), cookies() or headers() here.)
 */
export async function GET() {
  // The public proposal history gets a nav entry for signed-out visitors too.
  const historyOn = await toggleEnabled("proposals.historyEnabled").catch(() => false);
  return NextResponse.json(
    { authenticated: false, ...(historyOn ? { showProposals: true } : {}) },
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=600" } },
  );
}
