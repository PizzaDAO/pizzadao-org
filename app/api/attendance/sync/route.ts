import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { hasAnyRole } from "@/app/lib/discord";
import { ADMIN_ROLE_IDS } from "@/app/ui/constants";
import { syncAllCrewAttendance } from "@/app/lib/attendance";

export async function POST() {
  // Admin-only check
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAdmin = await hasAnyRole(session.discordId, ADMIN_ROLE_IDS);
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
