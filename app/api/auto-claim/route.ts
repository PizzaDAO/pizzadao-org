// app/api/auto-claim/route.ts
// Handles auto-claiming when Discord nickname matches a member name
// No password required since we verify via session + name match
import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { getDiscordTurtleRoles, mergeTurtles, parseTurtlesFromSheet } from "@/app/lib/discord-roles";

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
 * Auto-claim a member ID when the Discord nickname matches the member name.
 * This is more secure than sending a hardcoded password from the client.
 */
export async function POST(req: Request) {
    try {
        const session = await getSession();
        const sessionDiscordId = session?.discordId ? String(session.discordId).trim() : "";

        if (!sessionDiscordId) {
            return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
        }

        const body = await req.json();
        const { memberId, expectedName } = body;

        if (!memberId) {
            return NextResponse.json({ error: "Missing memberId" }, { status: 400 });
        }

        // Fetch the member data to verify name match
        const gvizUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?sheet=${encodeURIComponent(TAB_NAME)}&tqx=out:json`;
        const res = await fetch(gvizUrl, { cache: "no-store" });
        if (!res.ok) throw new Error("Failed to fetch sheet");

        const text = await res.text();
        const gviz = parseGvizJson(text);
        const rows = gviz?.table?.rows || [];

        // Find header row
        let headerRowIdx = -1;
        let headerVals: string[] = [];
        for (let ri = 0; ri < Math.min(rows.length, 100); ri++) {
            const rowCells = rows[ri]?.c || [];
            const rowValsLower = rowCells.map((c: any) => String(c?.v || c?.f || "").trim().toLowerCase());
            const hasName = rowValsLower.includes("name");
            const hasStatus = rowValsLower.includes("status") || rowValsLower.includes("frequency");
            if (hasName && hasStatus) {
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

        const idxId = headerMap.get("id") ?? headerMap.get("member id") ?? headerMap.get("memberid") ?? 0;
        const idxName = headerMap.get("name") ?? headerMap.get("mafia name");
        const idxDiscord = headerMap.get("discordid") ?? headerMap.get("discord id") ?? headerMap.get("discord");
        const idxTurtles = headerMap.get("turtles") ?? headerMap.get("roles");

        if (idxName == null) {
            return NextResponse.json({ error: "Name column not found" }, { status: 500 });
        }

        // Find the member row
        const targetId = parseInt(String(memberId), 10);
        for (let ri = headerRowIdx + 1; ri < rows.length; ri++) {
            const cells = rows[ri]?.c || [];
            const idVal = cells[idxId]?.v;
            const rowId = typeof idVal === "number" ? idVal : parseInt(String(idVal), 10);

            if (rowId === targetId) {
                const memberName = String(cells[idxName]?.v ?? cells[idxName]?.f ?? "").trim();
                const existingDiscord = idxDiscord != null
                    ? String(cells[idxDiscord]?.v ?? cells[idxDiscord]?.f ?? "").trim()
                    : "";

                // Verify name match (case-insensitive)
                if (!expectedName || memberName.toLowerCase() !== expectedName.toLowerCase()) {
                    return NextResponse.json({
                        error: "Name mismatch - cannot auto-claim",
                        canAutoClaim: false
                    }, { status: 403 });
                }

                // Check if already claimed by someone else
                if (existingDiscord && existingDiscord !== sessionDiscordId) {
                    return NextResponse.json({
                        error: "This member is already claimed by another Discord account",
                        canAutoClaim: false
                    }, { status: 409 });
                }

                // If already claimed by same user, return success
                if (existingDiscord === sessionDiscordId) {
                    return NextResponse.json({ ok: true, alreadyClaimed: true });
                }

                // Fetch existing turtles and merge with Discord roles
                const existingTurtlesRaw = idxTurtles != null
                    ? String(cells[idxTurtles]?.v ?? cells[idxTurtles]?.f ?? "")
                    : "";
                const existingTurtles = parseTurtlesFromSheet(existingTurtlesRaw);
                const discordTurtles = await getDiscordTurtleRoles(sessionDiscordId);
                const mergedTurtles = mergeTurtles(existingTurtles, discordTurtles);

                console.log("[auto-claim] Turtle sync:", {
                    existing: existingTurtles,
                    discord: discordTurtles,
                    merged: mergedTurtles,
                });

                // Proceed with claim via Google Sheets Web App
                const url = process.env.GOOGLE_SHEETS_WEBAPP_URL;
                const secret = process.env.GOOGLE_SHEETS_SHARED_SECRET;
                if (!url || !secret) {
                    return NextResponse.json({ error: "Missing Sheets env vars" }, { status: 500 });
                }

                // Match the profile route's payload structure - fields at top level AND in raw
                const payload = {
                    secret,
                    source: "onboarding_auto_claim",
                    memberId: String(memberId),
                    discordId: sessionDiscordId,
                    discordJoined: true,
                    turtles: mergedTurtles.length > 0 ? mergedTurtles.join(", ") : undefined,
                    raw: {
                        source: "onboarding_auto_claim",
                        memberId: String(memberId),
                        discordId: sessionDiscordId,
                        discordJoined: true,
                        turtles: mergedTurtles.length > 0 ? mergedTurtles.join(", ") : undefined,
                    },
                };

                const sheetRes = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                });

                const sheetText = await sheetRes.text();
                let parsed: any = null;
                try {
                    parsed = JSON.parse(sheetText);
                } catch { }

                if (!sheetRes.ok || parsed?.ok === false) {
                    return NextResponse.json({
                        error: "Failed to update sheet",
                        details: parsed?.error ?? sheetText,
                    }, { status: 502 });
                }

                // Create voting identity for the user (fire-and-forget, don't block on failure)
                try {
                    const governanceUrl = process.env.GOVERNANCE_API_URL || 'http://localhost:3003';
                    fetch(`${governanceUrl}/api/governance/create-identity`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            discordId: sessionDiscordId,
                            secret,
                        }),
                    }).then(res => {
                        if (res.ok) {
                            console.log(`[auto-claim] Created voting identity for ${sessionDiscordId}`);
                        } else {
                            console.warn(`[auto-claim] Failed to create voting identity for ${sessionDiscordId}`);
                        }
                    }).catch(err => {
                        console.warn(`[auto-claim] Error creating voting identity:`, err.message);
                    });
                } catch (err) {
                    // Don't fail the claim if identity creation fails
                    console.warn('[auto-claim] Error initiating identity creation:', err);
                }

                return NextResponse.json({ ok: true });
            }
        }

        return NextResponse.json({ error: `Member ID ${memberId} not found` }, { status: 404 });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
    }
}
