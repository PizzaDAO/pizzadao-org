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
        let headerRowVals: string[] = [];

        for (let ri = 0; ri < Math.min(rows.length, 100); ri++) {
            const rowCells = rows[ri]?.c || [];
            const rowVals = rowCells.map((c: any) => String(c?.v || c?.f || "").trim().toLowerCase());

            const hasName = rowVals.includes("name");
            const hasStatus = rowVals.includes("status") || rowVals.includes("frequency");
            const hasCity = rowVals.includes("city") || rowVals.includes("crews");

            if (hasName && (hasStatus || hasCity)) {
                headerRowIdx = ri;
                headerRowVals = rowCells.map((c: any) => String(c?.v || c?.f || "").trim());
                break;
            }
        }

        if (headerRowIdx === -1) {
            throw new Error(`Could not find header row (Name + Status/City). Checked 100 rows.`);
        }

        // Find standard column indices in the detected header row
        let idColIdx = -1;
        let discordColIdx = -1;
        const normalizedHeaders = headerRowVals.map(h => h.toLowerCase().replace(/[#\s\-_]+/g, ""));

        normalizedHeaders.forEach((h, ci) => {
            if (h === "id" || h === "crewid" || h === "memberid") idColIdx = ci;
            if (h === "discordid" || h === "discord" || h === "discorduser") discordColIdx = ci;
        });

        if (idColIdx === -1) idColIdx = 0; // fallback to A
        if (discordColIdx === -1) {
            throw new Error(`Could not find Discord column (DiscordID, Discord). Found: ${headerRowVals.join(", ")}`);
        }

        const dataStartIdx = headerRowIdx + 1;
        const userRow = rows.slice(dataStartIdx).find((r: any) => {
            const cellVal = r?.c?.[discordColIdx]?.v ?? r?.c?.[discordColIdx]?.f;
            if (cellVal === null || cellVal === undefined) return false;
            return String(cellVal).trim() === discordId;
        });

        if (!userRow) {
            const sampleDiscordIds = rows.slice(dataStartIdx, dataStartIdx + 5).map((r: any) => r?.c?.[discordColIdx]?.v ?? r?.c?.[discordColIdx]?.f).filter(Boolean);
            return NextResponse.json({
                error: `Member not found for Discord ID '${discordId}'. Found in sheet: ${sampleDiscordIds.join(", ")}. Column ${discordColIdx} ('${headerRowVals[discordColIdx]}')`,
                status: 404
            }, { status: 404 });
        }

        // Map data using human-readable keys from the header row
        const data: any = {};
        headerRowVals.forEach((rawKey, idx) => {
            if (!rawKey) return;
            const val = userRow.c?.[idx]?.v ?? userRow.c?.[idx]?.f;
            data[rawKey] = val;
        });

        // Add standardized aliases for UI convenience
        data["Status"] = data["Status"] || data["Frequency"];
        data["Orgs"] = data["Orgs"] || data["Affiliation"];
        data["Skills"] = data["Skills"] || data["Specialties"];
        data["DiscordID"] = data["DiscordID"] || data["Discord"];

        const memberId = userRow.c?.[idColIdx]?.v ?? userRow.c?.[idColIdx]?.f;

        return NextResponse.json({ found: true, memberId, data });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
