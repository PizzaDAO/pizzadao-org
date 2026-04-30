import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { hasAnyRole } from "@/app/lib/discord";
import { ADMIN_ROLE_IDS } from "@/app/ui/constants";
import { syncAllCrewAttendance } from "@/app/lib/attendance";

export async function POST(request: NextRequest) {
  // Auth: either Discord admin session OR CRON_SECRET bearer token
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET?.trim();
  const hasBearerToken =
    cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!hasBearerToken) {
    // Fall back to Discord session auth
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const isAdmin = await hasAnyRole(session.discordId, ADMIN_ROLE_IDS);
    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    const stats = await syncAllCrewAttendance();
    return NextResponse.json(stats);
  } catch (err) {
    console.error("[attendance] Sync error:", err);
    return NextResponse.json(
      { error: "Sync failed", details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
