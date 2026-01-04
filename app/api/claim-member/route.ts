
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const SHEET_ID = "16BBOfasVwz8L6fPMungz_Y0EfF6Z9puskLAix3tCHzM";
const TAB_NAME = "Crew";

// --- Helpers copied from user-data route ---
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

async function fetchMemberData(id: string) {
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

        if (hasName && hasStatus) {
            headerRowIdx = ri;
            headerRowVals = rowCells.map((c: any) => String(c?.v || c?.f || "").trim());
            break;
        }
    }

    if (headerRowIdx === -1) {
        throw new Error(`Could not find header row. Checked 100 rows.`);
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

    if (!userRow) return null;

    const data: any = {};
    headerRowVals.forEach((rawKey, idx) => {
        if (!rawKey) return;
        const val = userRow.c?.[idx]?.v ?? userRow.c?.[idx]?.f;
        data[rawKey] = val;
    });
    return data;
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { memberId, discordId, password } = body;

        // 1. Password check
        if (password !== "moltobenny") {
            return NextResponse.json({ error: "Incorrect password" }, { status: 403 });
        }

        if (!memberId || !discordId) {
            return NextResponse.json({ error: "Missing memberId or discordId" }, { status: 400 });
        }

        // 2. Fetch existing data (Crucial to preserve Name)
        const existingData = await fetchMemberData(memberId);
        if (!existingData) {
            return NextResponse.json({ error: `Member ID ${memberId} not found` }, { status: 404 });
        }

        const existingName = existingData["Name"] || existingData["Mafia Name"];
        if (!existingName) {
            // This is weird if we found the row, but maybe name is blank?
            // If name is blank in sheet, sending blank is fine.
        }

        // 3. Update via Google Sheets Web App
        const url = process.env.GOOGLE_SHEETS_WEBAPP_URL;
        const secret = process.env.GOOGLE_SHEETS_SHARED_SECRET;
        if (!url || !secret) {
            return NextResponse.json({ error: "Missing Sheets env vars" }, { status: 500 });
        }

        const payload = {
            secret,
            // Only send what's needed for claim - backend now skips undefined fields
            raw: {
                source: "onboarding_claim",
                memberId: String(memberId),
                discordId: String(discordId),
                discordJoined: true,
                // Do NOT send mafiaName, city, crews, turtles - they will remain unchanged
            }
        };

        const sheetRes = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        const text = await sheetRes.text();
        let parsed: any = null;
        try {
            parsed = JSON.parse(text);
        } catch { }

        if (!sheetRes.ok || parsed?.ok === false) {
            return NextResponse.json({
                error: "Failed to update sheet",
                details: parsed?.error ?? text
            }, { status: 502 });
        }

        return NextResponse.json({ ok: true });

    } catch (e: any) {
        return NextResponse.json({ error: e.message || "Unknown error" }, { status: 500 });
    }
}
