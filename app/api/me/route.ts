// app/api/me/route.ts
// Returns the current session info for the authenticated user
import { NextResponse } from "next/server";
import { getSession, getSessionCookieOptions } from "@/app/lib/session";
import { setAuthHint } from "@/app/lib/auth-hint";
import { findMemberIdByDiscordId } from "@/app/lib/member-utils";

export const runtime = "nodejs";

export async function GET() {
    const session = await getSession();

    if (!session?.discordId) {
        const res = NextResponse.json({ authenticated: false }, { status: 401 });
        setAuthHint(res, "0", getSessionCookieOptions());
        return res;
    }

    // Look up memberId from discordId
    let memberId: string | null = null;
    try {
        memberId = await findMemberIdByDiscordId(session.discordId);
    } catch {
        // Silently fail - memberId will be null
    }

    const res = NextResponse.json({
        authenticated: true,
        discordId: session.discordId,
        username: session.username,
        nick: session.nick,
        memberId,
    });
    // Heals a stale hint "0" when the session is actually valid.
    setAuthHint(res, "1", getSessionCookieOptions());
    return res;
}
