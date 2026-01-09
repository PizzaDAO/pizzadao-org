// app/api/me/route.ts
import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";

export const runtime = "nodejs";

/**
 * Returns the current user's session info.
 * Used by frontend to check auth state and get discordId.
 */
export async function GET() {
    const session = await getSession();

    if (!session?.discordId) {
        return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    return NextResponse.json({
        authenticated: true,
        discordId: session.discordId,
        username: session.username,
        nick: session.nick,
    });
}
