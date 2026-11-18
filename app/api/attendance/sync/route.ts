import { after, NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/lib/auth-guards";
import { isCronAuthorized } from "@/app/lib/cron-auth";
import { syncAllCrewAttendance } from "@/app/lib/attendance";
import { internalError } from "@/app/lib/errors/error-response";
import { emitMissionEventMany } from "@/app/lib/mission-verify/events";

export async function POST(request: NextRequest) {
  try {
    // Auth: either CRON_SECRET bearer token OR a Discord admin session
    if (!isCronAuthorized(request.headers.get("authorization"))) {
      const admin = await requireAdmin();
      if (!admin.ok) return admin.response;
    }

    const { affectedDiscordIds = [], ...stats } = await syncAllCrewAttendance();
    // Members who gained attendance rows: re-check the call missions (L2.0, L5.0).
    if (affectedDiscordIds.length) after(() => emitMissionEventMany(affectedDiscordIds, "attendance_synced"));
    return NextResponse.json({ ...stats, affectedMembers: affectedDiscordIds.length });
  } catch (err) {
    return internalError(err, "attendance/sync", "Sync failed");
  }
}
