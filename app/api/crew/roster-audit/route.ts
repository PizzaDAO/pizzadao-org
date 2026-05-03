import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { hasAnyRole } from "@/app/lib/discord";
import { ADMIN_ROLE_IDS } from "@/app/ui/constants";
import { runRosterAudit } from "@/app/lib/roster-audit";
import { updateMemberCrews } from "@/app/lib/roster-writeback";

export async function GET(request: NextRequest) {
  // Auth: either CRON_SECRET bearer token OR Discord admin session
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET?.trim();
  const hasBearerToken = cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!hasBearerToken) {
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
    const result = await runRosterAudit();
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    console.error("[roster-audit] Error:", err);
    return NextResponse.json(
      { error: "Audit failed", details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  // Admin-only write-back: add or remove a member from a crew
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const isAdmin = await hasAnyRole(session.discordId, ADMIN_ROLE_IDS);
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { memberId, action, crewId } = body as {
      memberId: string;
      action: "add" | "remove";
      crewId: string;
    };

    if (!memberId || !action || !crewId) {
      return NextResponse.json(
        { error: "Missing required fields: memberId, action, crewId" },
        { status: 400 }
      );
    }

    if (action !== "add" && action !== "remove") {
      return NextResponse.json(
        { error: "action must be 'add' or 'remove'" },
        { status: 400 }
      );
    }

    const result = await updateMemberCrews(memberId, crewId, action);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[roster-audit] Write-back error:", err);
    return NextResponse.json(
      { error: "Write-back failed", details: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
