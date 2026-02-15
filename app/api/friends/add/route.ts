import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { fetchMemberById } from "@/app/lib/sheets/member-repository";
import { findMemberByDiscordId } from "@/app/lib/member-utils";
import { addFriend, notifyFriendAdded } from "@/app/lib/friends";

export const runtime = "nodejs";

/**
 * POST /api/friends/add
 * Authenticated - add a friend (follow)
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

    // Look up the current user's memberId from their discordId
    const currentUser = await findMemberByDiscordId(session.discordId);
    if (!currentUser || !currentUser.memberId) {
      return NextResponse.json(
        { error: "Could not find your member profile" },
        { status: 404 }
      );
    }

    if (currentUser.memberId === targetMemberId) {
      return NextResponse.json(
        { error: "Cannot follow yourself" },
        { status: 400 }
      );
    }

    // Verify target member exists
    const targetMember = await fetchMemberById(targetMemberId);
    if (!targetMember) {
      return NextResponse.json(
        { error: "Target member not found" },
        { status: 404 }
      );
    }

    // Create the friendship
    await addFriend(currentUser.memberId, targetMemberId);

    // Notify the target (non-blocking)
    const targetDiscordId = targetMember.discordId;
    if (targetDiscordId) {
      notifyFriendAdded(
        targetMemberId,
        currentUser.name || "Someone",
        currentUser.memberId,
        targetDiscordId
      ).catch(() => {
        // Silently fail notification
      });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    // Handle unique constraint violation (already following)
    if (err?.code === "P2002") {
      return NextResponse.json(
        { error: "Already following this member" },
        { status: 409 }
      );
    }
    console.error("Failed to add friend:", err);
    return NextResponse.json(
      { error: "Failed to add friend" },
      { status: 500 }
    );
  }
}
