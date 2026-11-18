import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/app/lib/cron-auth";
import { internalError } from "@/app/lib/errors/error-response";
import { runTriviaCron } from "@/app/lib/trivia/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/trivia: the Discord trivia poster and round expiry (Vercel Cron every 5 minutes,
 * `Authorization: Bearer $CRON_SECRET`). A no-op unless this is the production deployment AND
 * trivia.enabled is on (previews share the production database). See app/lib/trivia/cron.ts.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runTriviaCron();
    console.log("[cron/trivia]", JSON.stringify(result));
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return internalError(err, "cron/trivia", "Trivia cron failed");
  }
}
