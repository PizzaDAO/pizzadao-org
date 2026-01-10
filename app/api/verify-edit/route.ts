// app/api/verify-edit/route.ts
import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";

export const runtime = "nodejs";

const SHEET_ID = "16BBOfasVwz8L6fPMungz_Y0EfF6Z9puskLAix3tCHzM";
const TAB_NAME = "Crew";

function parseGvizJson(text: string) {
    const cleaned = text.replace(/^\s*\/\*O_o\*\/\s*/m, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
        throw new Error("GViz: Unexpected response");
    }
    return JSON.parse(cleaned.slice(start, end + 1));
}

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
        // headers=0 ensures the header row is included in the response
        const gvizUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?sheet=${encodeURIComponent(TAB_NAME)}&tqx=out:json&headers=0`;
        const res = await fetch(gvizUrl, { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to fetch sheet");

        const text = await res.text();
        const gviz = parseGvizJson(text);
        const rows = gviz?.table?.rows || [];

        // Find header row (same logic as member-lookup)
        let headerRowIdx = -1;
        let headerVals: string[] = [];
        for (let ri = 0; ri < Math.min(rows.length, 100); ri++) {
            const rowCells = rows[ri]?.c || [];
            const rowValsLower = rowCells.map((c: any) => String(c?.v || c?.f || "").trim().toLowerCase());
            const hasName = rowValsLower.includes("name");
            const hasStatus = rowValsLower.includes("status") || rowValsLower.includes("frequency");
            const hasCity = rowValsLower.includes("city") || rowValsLower.includes("crews");
            if (hasName && (hasStatus || hasCity)) {
                headerRowIdx = ri;
                headerVals = rowCells.map((c: any) => String(c?.v || c?.f || "").trim());
                break;
            }
        }

        if (headerRowIdx === -1) {
            return NextResponse.json({ error: "Header row not found" }, { status: 500 });
        }

        const headerMap = new Map<string, number>();
        headerVals.forEach((h, i) => headerMap.set(h.trim().toLowerCase(), i));

        // Find ID column, fallback to column 0 if not found (matches member-lookup behavior)
        let idxId = headerMap.get("id") ?? headerMap.get("member id") ?? headerMap.get("memberid");
        if (idxId == null) idxId = 0; // fallback to column A
        const idxDiscord = headerMap.get("discordid") ?? headerMap.get("discord id") ?? headerMap.get("discord");

        // Find the row with matching memberId
        for (let ri = headerRowIdx + 1; ri < rows.length; ri++) {
            const cells = rows[ri]?.c || [];
            const idVal = String(cells[idxId]?.v ?? cells[idxId]?.f ?? "").trim();

            if (idVal === memberId) {
                const discordVal = idxDiscord != null
                    ? String(cells[idxDiscord]?.v ?? cells[idxDiscord]?.f ?? "").trim()
                    : "";

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

                // Build the member data object
                const data: Record<string, any> = {};
                headerVals.forEach((key, idx) => {
                    if (!key) return;
                    const val = cells[idx]?.v ?? cells[idx]?.f;
                    data[key] = val;
                });

                return NextResponse.json({
                    canEdit: true,
                    memberId,
                    data
                });
            }
        }

        return NextResponse.json({ error: "Member not found" }, { status: 404 });
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Failed to verify";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
