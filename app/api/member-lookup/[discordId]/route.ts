// app/api/member-lookup/[discordId]/route.ts
import { NextResponse } from "next/server";

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

export async function GET(
    request: Request,
    { params }: { params: Promise<{ discordId: string }> }
) {
    try {
        const { discordId } = await params;
        if (!discordId) return NextResponse.json({ error: "Missing Discord ID" }, { status: 400 });

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

            // Look for a row that contains "Name" AND ("City" OR "Crews")
            const hasName = rowVals.includes("name");
            const hasCity = rowVals.includes("city");
            const hasCrews = rowVals.includes("crews");

            if (hasName && (hasCity || hasCrews)) {
                headerRowIdx = ri;
                break;
            }
        }

        if (headerRowIdx === -1) {
            throw new Error(`Could not find a header row containing 'Name' and 'City'/'Crews' after scanning 50 rows. Please ensure you are looking at the correct tab.`);
        }

        const headerRow = rows[headerRowIdx]?.c || [];
        let idColIdx = -1;
        let discordColIdx = -1;

        headerRow.forEach((cell: any, ci: number) => {
            const val = String(cell?.v || cell?.f || "").trim().toLowerCase();
            // Fallback for Column A if it's null in GViz but contains ID in the actual sheet
            if (ci === 0 && (!val || val === "null")) {
                // We'll peek at the next row's cell 0. If it's a number, this is likely the ID column.
                const nextRowVal = rows[headerRowIdx + 1]?.c?.[0]?.v;
                if (typeof nextRowVal === "number" || (nextRowVal && !isNaN(Number(nextRowVal)))) {
                    idColIdx = ci;
                }
            }
            if (val === "id" || val === "crew id" || val.includes("# id")) idColIdx = ci;
            if (val === "discordid" || val === "discord id" || val === "discord") discordColIdx = ci;
        });

        if (idColIdx === -1) idColIdx = 0; // fallback to first column
        if (discordColIdx === -1) {
            throw new Error(`Could not find Discord column in the header row detected at index ${headerRowIdx}. Found headers: ${headerRow.map((c: any) => c?.v || "null").join(", ")}`);
        }

        const dataStartIdx = headerRowIdx + 1;
        const userRow = rows.slice(dataStartIdx).find((r: any) => {
            const cellVal = r?.c?.[discordColIdx]?.v;
            if (cellVal === null || cellVal === undefined) return false;
            return String(cellVal).trim() === discordId;
        });

        if (!userRow) {
            return NextResponse.json({ error: "Member not found" }, { status: 404 });
        }

        // Map columns to keys using the header row values
        const data: any = {};
        cols.forEach((_col: any, idx: number) => {
            const headVal = headerRow[idx]?.v;
            const key = headVal ? String(headVal).trim() : `field_${idx}`;

            const val = userRow.c?.[idx]?.v;
            data[key] = val;
        });

        const memberId = userRow.c?.[idColIdx]?.v;

        return NextResponse.json({ found: true, memberId, data });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
