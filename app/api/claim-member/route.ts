// app/api/claim-member/route.ts
import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { getDiscordTurtleRoles, mergeTurtles, parseTurtlesFromSheet } from "@/app/lib/discord-roles";

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
    const normalizedHeaders = headerRowVals.map((h) => h.toLowerCase().replace(/[#\s\-_]+/g, ""));
    const idAliases = ["id", "crewid", "memberid"];
    for (let i = 0; i < normalizedHeaders.length; i++) {
        if (idAliases.includes(normalizedHeaders[i])) {
            idColIdx = i;
            break;
        }
    }
    if (idColIdx === -1) idColIdx = 0;

    // Also find Discord ID column index (best-effort)
    let discordColIdx = -1;
    const discordAliases = ["discordid", "discord", "discorduserid", "discorduserid"];
    for (let i = 0; i < normalizedHeaders.length; i++) {
        if (discordAliases.includes(normalizedHeaders[i])) {
            discordColIdx = i;
            break;
        }
    }

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

    // Add a normalized discordId hint for checks
    const existingDiscord =
        discordColIdx >= 0 ? String(userRow.c?.[discordColIdx]?.v ?? userRow.c?.[discordColIdx]?.f ?? "").trim() : "";
    (data as any).__existingDiscordId = existingDiscord;

    return data;
}

export async function POST(req: Request) {
    try {
        const session = await getSession();
        const sessionDiscordId = session?.discordId ? String(session.discordId).trim() : "";

        if (!sessionDiscordId) {
            return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
        }

        const body = await req.json();
        const { memberId, password } = body;

        // 1) Password check using environment variable
        const claimPassword = process.env.CLAIM_PASSWORD;
        if (!claimPassword) {
            return NextResponse.json({ error: "Claim password not configured" }, { status: 500 });
        }
        if (password !== claimPassword) {
            return NextResponse.json({ error: "Incorrect password" }, { status: 403 });
        }

        if (!memberId) {
            return NextResponse.json({ error: "Missing memberId" }, { status: 400 });
        }

        // 2) Fetch existing data (to ensure row exists and to prevent claiming someone else's row)
        const existingData = await fetchMemberData(String(memberId));
        if (!existingData) {
            return NextResponse.json({ error: `Member ID ${memberId} not found` }, { status: 404 });
        }

        // Get member name for better error messages
        const memberName = String(
            (existingData as any)["Name"] ||
            (existingData as any)["Mafia Name"] ||
            (existingData as any)["name"] ||
            ""
        ).trim();

        const alreadyClaimedDiscord = String((existingData as any).__existingDiscordId || "").trim();
        if (alreadyClaimedDiscord && alreadyClaimedDiscord !== sessionDiscordId) {
            return NextResponse.json(
                {
                    error: memberName
                        ? `Member ID ${memberId} belongs to "${memberName}" and is already claimed by another Discord account.`
                        : `Member ID ${memberId} is already claimed by another Discord account.`,
                    memberName,
                },
                { status: 409 }
            );
        }

        // If already claimed by same user, treat as success (idempotent)
        if (alreadyClaimedDiscord === sessionDiscordId) {
            return NextResponse.json({ ok: true, alreadyClaimed: true });
        }

        // 3) Fetch Discord turtle roles and merge with existing sheet turtles
        const existingTurtles = parseTurtlesFromSheet(
            (existingData as any)["Turtles"] || (existingData as any)["Roles"] || ""
        );
        const discordTurtles = await getDiscordTurtleRoles(sessionDiscordId);
        const mergedTurtles = mergeTurtles(existingTurtles, discordTurtles);

        console.log("[claim-member] Turtle sync:", {
            existing: existingTurtles,
            discord: discordTurtles,
            merged: mergedTurtles,
        });

        // 4) Update via Google Sheets Web App
        const url = process.env.GOOGLE_SHEETS_WEBAPP_URL;
        const secret = process.env.GOOGLE_SHEETS_SHARED_SECRET;
        if (!url || !secret) {
            return NextResponse.json({ error: "Missing Sheets env vars" }, { status: 500 });
        }

        // Match the profile route's payload structure - fields at top level AND in raw
        const payload = {
            secret,
            source: "onboarding_claim",
            memberId: String(memberId),
            discordId: sessionDiscordId,
            discordJoined: true,
            turtles: mergedTurtles.length > 0 ? mergedTurtles.join(", ") : undefined,
            raw: {
                source: "onboarding_claim",
                memberId: String(memberId),
                discordId: sessionDiscordId,
                discordJoined: true,
                turtles: mergedTurtles.length > 0 ? mergedTurtles.join(", ") : undefined,
            },
        };

        console.log("[claim-member] Sending to Apps Script:", {
            memberId: payload.memberId,
            discordId: payload.discordId,
            source: payload.source,
        });

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

        console.log("[claim-member] Apps Script response:", {
            httpStatus: sheetRes.status,
            ok: parsed?.ok,
            crewSync: parsed?.crewSync,
        });

        if (!sheetRes.ok || parsed?.ok === false) {
            console.error("[claim-member] Apps Script error:", parsed?.crewSync?.error ?? parsed?.error ?? text);
            return NextResponse.json(
                {
                    error: "Failed to update sheet",
                    details: parsed?.crewSync?.error ?? parsed?.error ?? text,
                },
                { status: 502 }
            );
        }

        console.log("[claim-member] Successfully claimed member", memberId, "with discordId", sessionDiscordId);

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
                    console.log(`[claim-member] Created voting identity for ${sessionDiscordId}`);
                } else {
                    console.warn(`[claim-member] Failed to create voting identity for ${sessionDiscordId}`);
                }
            }).catch(err => {
                console.warn(`[claim-member] Error creating voting identity:`, err.message);
            });
        } catch (err) {
            // Don't fail the claim if identity creation fails
            console.warn('[claim-member] Error initiating identity creation:', err);
        }

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
    }
}
