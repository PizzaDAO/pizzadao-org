import { after, NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { hasAnyRole } from "@/app/lib/discord";
import { ADMIN_ROLE_IDS } from "@/app/ui/constants";
import { syncAllCrewAttendance } from "@/app/lib/attendance";
import { internalError } from "@/app/lib/errors/error-response";
import { emitMissionEventMany } from "@/app/lib/mission-verify/events";

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
    const { affectedDiscordIds = [], ...stats } = await syncAllCrewAttendance();
    // Members who gained attendance rows: re-check the call missions (L2.0, L5.0).
    if (affectedDiscordIds.length) after(() => emitMissionEventMany(affectedDiscordIds, "attendance_synced"));
    return NextResponse.json({ ...stats, affectedMembers: affectedDiscordIds.length });
  } catch (err) {
    return internalError(err, "attendance/sync", "Sync failed");
  }
}
