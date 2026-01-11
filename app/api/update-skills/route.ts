import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";

export const runtime = "nodejs";

// Fetch member row to verify ownership
async function fetchMemberRowById(memberId: string) {
    const SHEET_ID = "16BBOfasVwz8L6fPMungz_Y0EfF6Z9puskLAix3tCHzM";
    const TAB_NAME = "Crew";

    function parseGvizJson(text: string) {
        const cleaned = text.replace(/^\s*\/\*O_o\*\/\s*/m, "").trim();
        const start = cleaned.indexOf("{");
        const end = cleaned.lastIndexOf("}");
        if (start === -1 || end === -1 || end <= start) throw new Error("GViz: Unexpected response");
        return JSON.parse(cleaned.slice(start, end + 1));
    }

    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?sheet=${encodeURIComponent(TAB_NAME)}&tqx=out:json&headers=0`;

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to fetch sheet");
    const text = await res.text();
    const gviz = parseGvizJson(text);
    const rows = gviz?.table?.rows || [];

    // Find header row
    let headerRowIdx = -1;
    let headerVals: string[] = [];
    for (let ri = 0; ri < Math.min(rows.length, 100); ri++) {
        const rowCells = rows[ri]?.c || [];
        const rowVals = rowCells.map((c: any) => String(c?.v || c?.f || "").trim().toLowerCase());
        const hasName = rowVals.includes("name");
        const hasStatus = rowVals.includes("status") || rowVals.includes("frequency");
        const hasCity = rowVals.includes("city") || rowVals.includes("crews");
        if (hasName && (hasStatus || hasCity)) {
            headerRowIdx = ri;
            headerVals = rowCells.map((c: any) => String(c?.v || c?.f || "").trim());
            break;
        }
    }
    if (headerRowIdx === -1) throw new Error("Header row not found");

    const headerMap = new Map<string, number>();
    headerVals.forEach((h, i) => headerMap.set(h.trim().toLowerCase(), i));

    let idxId = headerMap.get("id") ?? headerMap.get("member id") ?? headerMap.get("memberid");
    if (idxId == null) idxId = 0;

    const idxDiscord = headerMap.get("discordid") ?? headerMap.get("discord id") ?? headerMap.get("discord");
    const idxName = headerMap.get("name");

    for (let ri = headerRowIdx + 1; ri < rows.length; ri++) {
        const cells = rows[ri]?.c || [];
        const idVal = String(cells[idxId]?.v ?? cells[idxId]?.f ?? "").trim();
        if (idVal && idVal === memberId) {
            const discordVal = idxDiscord != null ? String(cells[idxDiscord]?.v ?? cells[idxDiscord]?.f ?? "").trim() : "";
            const nameVal = idxName != null ? String(cells[idxName]?.v ?? cells[idxName]?.f ?? "").trim() : "";
            return { discordId: discordVal, name: nameVal };
        }
    }

    return null;
}

export async function POST(req: Request) {
    try {
        const session = await getSession();
        if (!session?.discordId) {
            return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
        }

        const { memberId, skills } = await req.json();

        if (!memberId) {
            return NextResponse.json({ error: "Missing memberId" }, { status: 400 });
        }

        // Verify ownership
        const row = await fetchMemberRowById(memberId);
        if (!row) {
            return NextResponse.json({ error: "Member not found" }, { status: 404 });
        }

        if (row.discordId !== session.discordId) {
            return NextResponse.json({ error: "Forbidden: cannot edit another member" }, { status: 403 });
        }

        // Write to sheet
        const url = process.env.GOOGLE_SHEETS_WEBAPP_URL;
        const secret = process.env.GOOGLE_SHEETS_SHARED_SECRET;
        if (!url || !secret) {
            return NextResponse.json({ error: "Missing Sheets webapp env vars" }, { status: 500 });
        }

        const payload = {
            secret,
            source: "skills-update",
            memberId,
            discordId: session.discordId,
            mafiaName: row.name, // Required by the sheet script
            skills: String(skills || "").trim().slice(0, 500),
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
            return NextResponse.json({ error: "Failed to update skills", details: parsed }, { status: 502 });
        }

        return NextResponse.json({ ok: true, skills: payload.skills });
    } catch (err: any) {
        console.error("[update-skills] Error:", err);
        return NextResponse.json({ error: err?.message ?? "Unknown error" }, { status: 500 });
    }
}
