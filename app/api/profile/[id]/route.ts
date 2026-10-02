import { NextRequest, NextResponse } from "next/server";
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

        // Build public profile data (exclude sensitive fields)
        const sensitiveFields = ["discordid", "discord", "telegram", "email", "wallet", "address"];
        const data: Record<string, any> = {};

        sheet.headers.forEach((rawKey, idx) => {
            if (!rawKey) return;
            const key = rawKey.toLowerCase();
            // Skip sensitive fields for public profile
            if (sensitiveFields.includes(key)) return;

            const val = userRow.c?.[idx]?.v ?? userRow.c?.[idx]?.f;
            data[rawKey] = val;
        });

        // Add standardized aliases
        data["Status"] = data["Status"] || data["Frequency"];
        data["Orgs"] = data["Orgs"] || data["Affiliation"];
        data["Skills"] = data["Skills"] || data["Specialties"];

        return NextResponse.json(data, { headers: cacheHeaders });
    } catch {
        return NextResponse.json({ error: "Failed to load profile" }, { status: 500 });
    }
}
