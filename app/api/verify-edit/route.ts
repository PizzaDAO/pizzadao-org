// app/api/verify-edit/route.ts
import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import {
    MEMBER_COLUMNS,
    cellText,
    findMemberRow,
    getMembersTable,
    membersColumn,
    rowToRecord,
} from "@/app/lib/sheets/member-repository";

export const runtime = "nodejs";

/**
 * Verifies that the current session owns a specific member ID.
 * Returns the member data if authorized.
 */
export async function GET(req: Request) {
    const session = await getSession();

    if (!session?.discordId) {
        return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const url = new URL(req.url);
    const memberId = url.searchParams.get("memberId");

    if (!memberId) {
        return NextResponse.json({ error: "Missing memberId" }, { status: 400 });
    }

    try {
        // Uncached on purpose: this is the ownership gate in front of the edit
        // flow, so it must see the row's current Discord ID.
        const sheet = await getMembersTable({ fresh: true }).catch(() => {
            throw new Error("Failed to fetch sheet");
        });

        if (sheet.headerRowIndex === -1) {
            return NextResponse.json({ error: "Header row not found" }, { status: 500 });
        }

        const idxDiscord = membersColumn(sheet, MEMBER_COLUMNS.discordId);

        // Find the row with matching memberId (exact text match on the ID cell)
        const row = findMemberRow(sheet, memberId, "exact");
        if (row) {
            const cells = row.c || [];
            const discordVal = idxDiscord != null ? cellText(cells[idxDiscord]) : "";

            // Check ownership
            if (!discordVal) {
                return NextResponse.json({
                    error: "This member has not been claimed yet",
                    canEdit: false
                }, { status: 403 });
            }

            if (discordVal !== session.discordId) {
                return NextResponse.json({
                    error: "You don't have permission to edit this member",
                    canEdit: false
                }, { status: 403 });
            }

            return NextResponse.json({
                canEdit: true,
                memberId,
                data: rowToRecord(sheet, row)
            });
        }

        return NextResponse.json({ error: "Member not found" }, { status: 404 });
    } catch (e: unknown) {
        const msg = e instanceof Error ? (e as any)?.message : "Failed to verify";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
