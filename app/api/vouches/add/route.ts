import { after, NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { giveVouch } from "@/app/lib/give-vouch";

export const runtime = "nodejs";

/**
 * POST /api/vouches/add
 * Authenticated - add a vouch
 * Body: { targetMemberId }
 *
 * The rules (own profile, no self-vouch, target exists, daily limit, one per pair, mission events,
 * notification) live in app/lib/give-vouch.ts, shared with the Discord /vouch command.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session?.discordId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json();
    const { targetMemberId } = body;

    if (!targetMemberId) {
      return NextResponse.json(
        { error: "Missing targetMemberId" },
        { status: 400 }
      );
    }

    const result = await giveVouch(
      { voucherDiscordId: session.discordId, targetMemberId: String(targetMemberId) },
      { defer: (job) => after(() => job().then(() => undefined, () => undefined)) },
    );

    if (result.ok) return NextResponse.json({ success: true });

    switch (result.reason) {
      case "no-profile":
        return NextResponse.json({ error: "Could not find your member profile" }, { status: 404 });
      case "self":
        return NextResponse.json({ error: "Cannot vouch for yourself" }, { status: 400 });
      case "not-found":
        return NextResponse.json({ error: "Target member not found" }, { status: 404 });
      case "duplicate":
        return NextResponse.json({ error: "Already vouched for this member" }, { status: 409 });
      case "limit":
        return NextResponse.json(
          { error: `Daily vouch limit reached (${result.limit} per day). Try again tomorrow.`, limit: result.limit },
          { status: 429 }
        );
    }
  } catch (err: any) {
    // Handle unique constraint violation (already vouched)
    if (err?.code === "P2002") {
      return NextResponse.json(
        { error: "Already vouched for this member" },
        { status: 409 }
      );
    }
    console.error("Failed to add vouch:", err);
    return NextResponse.json(
      { error: "Failed to add vouch" },
      { status: 500 }
    );
  }
}
