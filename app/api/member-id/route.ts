// app/api/member-id/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const SHEET_ID = "16BBOfasVwz8L6fPMungz_Y0EfF6Z9puskLAix3tCHzM";
const TAB_NAME = "Crew";

// Google GViz wraps JSON inside a JS function call
function parseGvizJson(text: string) {
    const cleaned = text.replace(/^\s*\/\*O_o\*\/\s*/m, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
        throw new Error("GViz: Unexpected response");
    }
    const json = cleaned.slice(start, end + 1);
    return JSON.parse(json);
}

function gvizUrl(sheetId: string, tabName?: string) {
    const url = new URL(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq`);
    url.searchParams.set("tqx", "out:json");
    if (tabName) url.searchParams.set("sheet", tabName);
    url.searchParams.set("headers", "0");
    return url.toString();
}

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const checkId = searchParams.get("check");

        const url = gvizUrl(SHEET_ID, TAB_NAME);
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to fetch sheet");
        const text = await res.text();
        const gviz = parseGvizJson(text);
        const rows = gviz?.table?.rows || [];
        const cols = gviz?.table?.cols || [];

        // --- Header Row Hunter ---
        let headerRowIdx = -1;
        for (let ri = 0; ri < Math.min(rows.length, 50); ri++) {
            const rowCells = rows[ri]?.c || [];
            const rowVals = rowCells.map((c: any) => String(c?.v || c?.f || "").trim().toLowerCase());
            const hasName = rowVals.includes("name");
            const hasCity = rowVals.includes("city");
            if (hasName && hasCity) {
                headerRowIdx = ri;
                break;
            }
        }

        const claimedIds = new Set<number>();

        if (headerRowIdx !== -1) {
            // Found the header row, data starts immediately after
            for (let i = headerRowIdx + 1; i < rows.length; i++) {
                const idVal = rows[i]?.c?.[0]?.v;
                if (typeof idVal === "number") {
                    claimedIds.add(idVal);
                } else if (typeof idVal === "string" && idVal.trim()) {
                    const parsed = parseInt(idVal.trim(), 10);
                    if (!isNaN(parsed)) claimedIds.add(parsed);
                }
            }
        } else {
            // Extreme fallback: just use column A and try to find numbers
            for (let i = 0; i < rows.length; i++) {
                const idVal = rows[i]?.c?.[0]?.v;
                if (typeof idVal === "number") {
                    claimedIds.add(idVal);
                } else if (typeof idVal === "string" && idVal.trim()) {
                    const parsed = parseInt(idVal.trim(), 10);
                    if (!isNaN(parsed)) claimedIds.add(parsed);
                }
            }
        }

        if (checkId) {
            const idToCheck = parseInt(checkId, 10);
            if (isNaN(idToCheck)) {
                return NextResponse.json({ available: false, error: "Invalid ID" });
            }
            return NextResponse.json({ available: !claimedIds.has(idToCheck) });
        }

        // Find next 4 lowest available IDs
        const suggestions: number[] = [];
        let current = 1;
        while (suggestions.length < 4 && current < 10000) {
            if (!claimedIds.has(current)) {
                suggestions.push(current);
            }
            current++;
        }

        return NextResponse.json({ suggestions });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
