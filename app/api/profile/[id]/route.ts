import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const SHEET_ID = "16BBOfasVwz8L6fPMungz_Y0EfF6Z9puskLAix3tCHzM";
const TAB_NAME = "Crew";

// Cache for public profiles
const CACHE = new Map<string, { time: number; data: any }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        if (!id) {
            return NextResponse.json({ error: "Missing member ID" }, { status: 400 });
        }

        // Check cache
        const cached = CACHE.get(id);
        if (cached && Date.now() - cached.time < CACHE_TTL) {
            return NextResponse.json(cached.data);
        }

        const url = gvizUrl(SHEET_ID, TAB_NAME);
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to fetch sheet");
        const text = await res.text();
        const gviz = parseGvizJson(text);
        const rows = gviz?.table?.rows || [];

        // Find header row
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
            throw new Error("Could not find header row");
        }

        // Find ID column index
        let idColIdx = -1;
        const normalizedHeaders = headerRowVals.map(h => h.toLowerCase().replace(/[#\s\-_]+/g, ""));
        const idAliases = ["id", "crewid", "memberid"];
        for (let i = 0; i < normalizedHeaders.length; i++) {
            if (idAliases.includes(normalizedHeaders[i])) {
                idColIdx = i;
                break;
            }
        }
        if (idColIdx === -1) idColIdx = 0;

        const targetId = parseInt(id, 10);
        const dataStartIdx = headerRowIdx + 1;

        const userRow = rows.slice(dataStartIdx).find((r: any) => {
            const val = r?.c?.[idColIdx]?.v;
            if (typeof val === "number") return val === targetId;
            if (typeof val === "string") return parseInt(val, 10) === targetId;
            return false;
        });

        if (!userRow) {
            return NextResponse.json({ error: "Member not found" }, { status: 404 });
        }

        // Build public profile data (exclude sensitive fields)
        const sensitiveFields = ["discordid", "discord", "telegram", "email", "wallet", "address"];
        const data: Record<string, any> = {};

        headerRowVals.forEach((rawKey, idx) => {
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

        // Cache the result
        CACHE.set(id, { time: Date.now(), data });

        return NextResponse.json(data);
    } catch (error: any) {
        return NextResponse.json({ error: "Failed to load profile" }, { status: 500 });
    }
}
