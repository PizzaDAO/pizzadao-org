// app/api/me/route.ts
// Returns the current session info for the authenticated user
import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { findMemberIdByDiscordId } from "@/app/lib/member-utils";

export const runtime = "nodejs";

export async function GET() {
    const session = await getSession();

    if (!session?.discordId) {
        return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    // Look up memberId from discordId
    let memberId: string | null = null;
    try {
        memberId = await findMemberIdByDiscordId(session.discordId);
    } catch {
        // Silently fail - memberId will be null
    }

    return NextResponse.json({
        authenticated: true,
        discordId: session.discordId,
        username: session.username,
        nick: session.nick,
        memberId,
    });
}
