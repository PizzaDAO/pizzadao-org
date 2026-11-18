import { NextRequest, NextResponse } from "next/server";
import { buildPublicProfile } from "@/app/lib/profile/public-profile";
import { findMemberRow, getMembersSheet } from "@/app/lib/sheets/member-repository";

export const runtime = "nodejs";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        if (!id) {
            return NextResponse.json({ error: "Missing member ID" }, { status: 400 });
        }

        const cacheHeaders = { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600' };

        // Public read: served from the members data cache (tag "members").
        const sheet = await getMembersSheet();

        const userRow = findMemberRow(sheet, id);

        if (!userRow) {
            return NextResponse.json({ error: "Member not found" }, { status: 404 });
        }

        // Allowlist projection: only fields the public clients use are served.
        const data = buildPublicProfile(sheet.headers, (idx) => userRow.c?.[idx]?.v ?? userRow.c?.[idx]?.f);

        return NextResponse.json(data, { headers: cacheHeaders });
    } catch {
        return NextResponse.json({ error: "Failed to load profile" }, { status: 500 });
    }
}
