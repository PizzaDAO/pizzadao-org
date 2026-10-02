import { fetchWithRedirect } from "@/app/lib/sheet-utils";
import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import {
    MEMBER_COLUMNS,
    cellText,
    findMemberRow,
    getMembersSheet,
    invalidateMembersCache,
    membersColumn,
} from "@/app/lib/sheets/member-repository";
import { internalError } from "@/app/lib/errors/error-response";

export const runtime = "nodejs";

// Fetch member row to verify ownership.
// Uncached on purpose: this ownership check guards the write below.
async function fetchMemberRowById(memberId: string) {
    // The client sends the ID as a string; like before, anything else never matches.
    if (typeof memberId !== "string") return null;
    const sheet = await getMembersSheet({ fresh: true });
    const row = findMemberRow(sheet, memberId, "exact");
    if (!row) return null;

    const idxDiscord = membersColumn(sheet, MEMBER_COLUMNS.discordId);
    const idxName = membersColumn(sheet, ["name"]);
    return {
        discordId: idxDiscord != null ? cellText(row.c?.[idxDiscord]) : "",
        name: idxName != null ? cellText(row.c?.[idxName]) : "",
    };
}

export async function POST(req: Request) {
    try {
        const session = await getSession();
        if (!session?.discordId) {
            return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
        }

        const { memberId, orgs } = await req.json();

        if (!memberId) {
            return NextResponse.json({ error: "Missing memberId" }, { status: 400 });
        }

        // Verify ownership
        const row = await fetchMemberRowById(memberId);
        if (!row) {
            return NextResponse.json({ error: "Member not found" }, { status: 404 });
        }

        if (row.discordId !== session.discordId) {
            return NextResponse.json({ error: "Forbidden: cannot edit another member" }, { status: 403 });
        }

        // Write to sheet
        const url = process.env.GOOGLE_SHEETS_WEBAPP_URL;
        const secret = process.env.GOOGLE_SHEETS_SHARED_SECRET;
        if (!url || !secret) {
            return NextResponse.json({ error: "Missing Sheets webapp env vars" }, { status: 500 });
        }

        const payload = {
            secret,
            source: "orgs-update",
            memberId,
            discordId: session.discordId,
            mafiaName: row.name, // Required by the sheet script
            orgs: String(orgs || "").trim().slice(0, 500),
        };

        const { status: sheetStatus, text } = await fetchWithRedirect(url, payload);

        let parsed: any = null;
        try {
            parsed = JSON.parse(text);
        } catch { }

        if (sheetStatus < 200 || sheetStatus >= 300 || parsed?.ok === false) {
            return NextResponse.json({ error: "Failed to update orgs", details: parsed }, { status: 502 });
        }

        invalidateMembersCache();

        return NextResponse.json({ ok: true, orgs: payload.orgs });
    } catch (err: any) {
        return internalError(err, "update-orgs", "Failed to update orgs");
    }
}
