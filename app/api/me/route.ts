// app/api/me/route.ts
// Returns the current session info for the authenticated user
import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";

export const runtime = "nodejs";

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
