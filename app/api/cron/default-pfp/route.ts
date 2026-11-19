import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/app/lib/cron-auth";
import { internalError } from "@/app/lib/errors/error-response";
import { runDefaultPfpAssignment } from "@/app/lib/default-pfp/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/cron/default-pfp: gives members without a picture of their own a unique dough ball
 * (Vercel Cron hourly, `Authorization: Bearer $CRON_SECRET`). A no-op unless defaultPfp.assignEnabled
 * is on (previews share the production database, so the toggle only counts on production).
 * See app/lib/default-pfp/job.ts.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runDefaultPfpAssignment();
    console.log("[cron/default-pfp]", JSON.stringify(result));
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return internalError(err, "cron/default-pfp", "Default PFP assignment failed");
  }
}
