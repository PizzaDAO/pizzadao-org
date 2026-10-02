import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { hasAnyRole } from "@/app/lib/discord";
import { ADMIN_ROLE_IDS } from "@/app/ui/constants";
import { runRosterAudit } from "@/app/lib/roster-audit";
import { updateMemberCrews, RosterWritebackError } from "@/app/lib/roster-writeback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Admin data: never let a shared/CDN cache store it.
const NO_STORE = { "Cache-Control": "private, no-store" };

async function requireAdmin(): Promise<NextResponse | null> {
  const session = await getSession();
  if (!session?.discordId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const isAdmin = await hasAnyRole(session.discordId, ADMIN_ROLE_IDS);
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  }
  return null;
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const result = await runRosterAudit();
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    console.error("[roster-audit] Error:", err);
    return NextResponse.json({ error: "Audit failed" }, { status: 500, headers: NO_STORE });
  }
}

/**
 * Add/remove one crew for one member.
 *
 * Body: { memberId, crewId, action: "add" | "remove", mode?: "dry-run" | "apply", expectedBefore? }
 * mode defaults to "dry-run" (no write). "apply" requires expectedBefore, the
 * `before` value returned by the dry run.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  if (!(request.headers.get("content-type") || "").includes("application/json")) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415, headers: NO_STORE });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: NO_STORE });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400, headers: NO_STORE });
  }
  const { memberId, crewId, action, mode, expectedBefore } = body as Record<string, unknown>;

  if (typeof memberId !== "string" || typeof crewId !== "string" || typeof action !== "string") {
    return NextResponse.json(
      { error: "Missing required fields: memberId, action, crewId" },
      { status: 400, headers: NO_STORE }
    );
  }
  if (action !== "add" && action !== "remove") {
    return NextResponse.json({ error: "action must be 'add' or 'remove'" }, { status: 400, headers: NO_STORE });
  }
  if (mode !== undefined && mode !== "dry-run" && mode !== "apply") {
    return NextResponse.json({ error: "mode must be 'dry-run' or 'apply'" }, { status: 400, headers: NO_STORE });
  }
  if (expectedBefore !== undefined && typeof expectedBefore !== "string") {
    return NextResponse.json({ error: "expectedBefore must be a string" }, { status: 400, headers: NO_STORE });
  }

  try {
    const result = await updateMemberCrews({
      memberId,
      crewId,
      action,
      mode: mode ?? "dry-run",
      expectedBefore,
    });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof RosterWritebackError) {
      return NextResponse.json({ error: err.message }, { status: err.status, headers: NO_STORE });
    }
    console.error("[roster-audit] Write-back error:", err);
    return NextResponse.json({ error: "Write-back failed" }, { status: 500, headers: NO_STORE });
  }
}
