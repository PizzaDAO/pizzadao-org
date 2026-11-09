import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { requestVouch } from "@/app/lib/vouch-request";
import { toggleEnabled } from "@/app/lib/settings/toggles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** GET /api/vouches/request: whether the "ask a member to vouch" feature is on for this viewer. */
export async function GET() {
  try {
    const session = await getSession();
    const enabled = !!session?.discordId && (await toggleEnabled("vouches.requestsEnabled"));
    return NextResponse.json({ enabled }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ enabled: false }, { headers: NO_STORE });
  }
}

/**
 * POST /api/vouches/request
 * Authenticated: ask one member to vouch for you. Body: { targetMemberId }.
 * Answers { success: true } or { error, reason } with a stable `reason` the client translates.
 * The rules live in app/lib/vouch-request.ts.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.discordId) {
      return NextResponse.json({ error: "Not authenticated", reason: "auth" }, { status: 401, headers: NO_STORE });
    }
    if (!(await toggleEnabled("vouches.requestsEnabled"))) {
      return NextResponse.json({ error: "Vouch requests are not available", reason: "disabled" }, { status: 404, headers: NO_STORE });
    }

    const body = await req.json().catch(() => ({}));
    const targetMemberId = String(body?.targetMemberId ?? "").trim();
    if (!targetMemberId) {
      return NextResponse.json({ error: "Missing targetMemberId", reason: "missing" }, { status: 400, headers: NO_STORE });
    }

    const result = await requestVouch({ senderDiscordId: session.discordId, targetMemberId });
    if (result.ok) return NextResponse.json({ success: true, targetName: result.targetName }, { headers: NO_STORE });

    const status: Record<string, number> = {
      "no-profile": 404,
      self: 400,
      "not-found": 404,
      unreachable: 422,
      "already-vouched": 409,
      pending: 409,
      limit: 429,
    };
    return NextResponse.json(
      { error: `Request not sent: ${result.reason}`, reason: result.reason, ...(result.reason === "limit" ? { limit: result.limit } : {}) },
      { status: status[result.reason] ?? 400, headers: NO_STORE },
    );
  } catch (err) {
    console.error("[vouches/request] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not send the request", reason: "error" }, { status: 500, headers: NO_STORE });
  }
}
