// app/api/user-data/[id]/route.ts
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
    const json = cleaned.slice(start, end + 1);
    return JSON.parse(json);
}

function gvizUrl(sheetId: string, tabName?: string) {
    const url = new URL(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq`);
    url.searchParams.set("tqx", "out:json");
    if (tabName) url.searchParams.set("sheet", tabName);
    url.searchParams.set("headers", "0");
    url.searchParams.set("_now", String(Date.now())); // Cache Buster
    return url.toString();
}

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        if (!id) return NextResponse.json({ error: "Missing ID" }, { status: 400 });

        // Require authentication
        const session = await getSession();
        if (!session?.discordId) {
            return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
        }

        const url = gvizUrl(SHEET_ID, TAB_NAME);
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to fetch sheet");
        const text = await res.text();
        const gviz = parseGvizJson(text);
        const rows = gviz?.table?.rows || [];
        const cols = gviz?.table?.cols || [];

        const labels = cols.map((c: any) => String(c?.label || "").trim().toLowerCase());

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

        // Find ID column index in the detected header row
        let idColIdx = -1;
        const normalizedHeaders = headerRowVals.map(h => h.toLowerCase().replace(/[#\s\-_]+/g, ""));

        // Look for ID
        const idAliases = ["id", "crewid", "memberid"];
        for (let i = 0; i < normalizedHeaders.length; i++) {
            if (idAliases.includes(normalizedHeaders[i])) {
                idColIdx = i;
                break;
            }
        }
        if (idColIdx === -1) idColIdx = 0; // fallback to A

        const targetId = parseInt(id, 10);
        const dataStartIdx = headerRowIdx + 1;

        const userRow = rows.slice(dataStartIdx).find((r: any) => {
            const val = r?.c?.[idColIdx]?.v;
            if (typeof val === "number") return val === targetId;
            if (typeof val === "string") return parseInt(val, 10) === targetId;
            return false;
        });

        if (!userRow) {
            const sampleIds = rows.slice(dataStartIdx, dataStartIdx + 10).map((r: any) => r?.c?.[idColIdx]?.v ?? r?.c?.[idColIdx]?.f).filter(Boolean);
            return NextResponse.json({
                error: `User ID ${id} not found. Sheet IDs: ${sampleIds.join(", ")}. Column index ${idColIdx} ('${headerRowVals[idColIdx]}')`,
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
        data["DiscordID"] = data["DiscordID"] || data["Discord"] || data["DiscordId"] || data["discordid"];

        // Verify ownership: user can only view their own data
        const memberDiscordId = String(data["DiscordID"] || "").trim();
        if (memberDiscordId && memberDiscordId !== session.discordId) {
            return NextResponse.json({ error: "Forbidden: You can only view your own data" }, { status: 403 });
        }

        return NextResponse.json(data);
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
