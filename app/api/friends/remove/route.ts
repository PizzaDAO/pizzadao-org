import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { findMemberIdByDiscordId } from "@/app/lib/member-utils";
import { removeFriend } from "@/app/lib/friends";

export const runtime = "nodejs";

/**
 * POST /api/friends/remove
 * Authenticated - remove a friend (unfollow)
 * Body: { targetMemberId }
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

    // Look up the current user's memberId
    const currentMemberId = await findMemberIdByDiscordId(session.discordId);
    if (!currentMemberId) {
      return NextResponse.json(
        { error: "Could not find your member profile" },
        { status: 404 }
      );
    }

    await removeFriend(currentMemberId, targetMemberId);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.error("Failed to remove friend:", err);
    return NextResponse.json(
      { error: "Failed to remove friend" },
      { status: 500 }
    );
  }
}
