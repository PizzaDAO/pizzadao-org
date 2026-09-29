import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/auth-guards";
import { syncDiscordRolesToSheet } from "@/app/lib/discord-sheet-sync";

export const runtime = "nodejs";

/**
 * Sync the CALLER's Discord roles into their own Crew sheet row.
 *
 * The Discord ID always comes from the session and the target row is resolved
 * from the sheet by that Discord ID. Any discordId/memberId in the body is ignored.
 */
export async function POST(req: Request) {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;

    try {
        let mafiaName: string | undefined;
        try {
            const body = await req.json();
            if (typeof body?.mafiaName === "string") mafiaName = body.mafiaName.slice(0, 100);
        } catch {
            // empty body is fine
        }

        const result = await syncDiscordRolesToSheet(auth.session.discordId, mafiaName);
        return NextResponse.json(result);
    } catch (error: unknown) {
        console.error("[sync-to-sheet] failed:", error);
        return NextResponse.json({ error: "Sync failed" }, { status: 500 });
    }
}
