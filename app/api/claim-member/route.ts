// app/api/claim-member/route.ts
import { fetchWithRedirect } from "@/app/lib/sheet-utils";
import {
    MEMBER_COLUMNS,
    cellText,
    findMemberRow,
    getMembersTable,
    invalidateMembersCache,
    membersColumn,
    rowToRecord,
} from "@/app/lib/sheets/member-repository";
import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { getDiscordTurtleRoles, mergeTurtles, parseTurtlesFromSheet } from "@/app/lib/discord-roles";
import { syncDiscordMember } from "@/app/lib/services/discord-api";
import { TURTLE_ROLE_IDS } from "@/app/ui/constants";

export const runtime = "nodejs";

/**
 * Fetch with redirect handling for Apps Script.
 * Apps Script returns 302 redirects that need to be followed manually for POST requests.
 * The redirect URL should be fetched with GET to retrieve the response.
 */

async function fetchMemberData(id: string) {
    // Uncached on purpose: the "already claimed by another account?" check below
    // must see the current Discord ID on the row before we write to it.
    const sheet = await getMembersTable({ fresh: true }).catch(() => {
        throw new Error("Failed to fetch sheet");
    });

    if (sheet.headerRowIndex === -1) {
        throw new Error(`Could not find header row. Checked 100 rows.`);
    }

    const discordColIdx = membersColumn(sheet, MEMBER_COLUMNS.discordId);
    const userRow = findMemberRow(sheet, id);

    if (!userRow) return null;

    const data: any = rowToRecord(sheet, userRow);

    // Add a normalized discordId hint for checks
    const existingDiscord = discordColIdx != null ? cellText(userRow.c?.[discordColIdx]) : "";
    (data as any).__existingDiscordId = existingDiscord;

    return data;
}

/**
 * Resolve turtle name to Discord role ID.
 * Handles various key formats in TURTLE_ROLE_IDS.
 */
function resolveTurtleRoleId(turtleName: string): string | null {
    const raw = String(turtleName ?? "").trim();
    if (!raw) return null;

    const upper = raw.toUpperCase();
    const upperUnderscore = raw.toUpperCase().replace(/\s+/g, "_");

    const turtleRoleIdsRecord = TURTLE_ROLE_IDS as Record<string, unknown>;
    const candidates = [
        TURTLE_ROLE_IDS[upper as keyof typeof TURTLE_ROLE_IDS],
        turtleRoleIdsRecord[upperUnderscore],
    ].filter(Boolean);

    return candidates.length ? String(candidates[0]) : null;
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

        const { status: sheetStatus, text } = await fetchWithRedirect(url, payload);

        let parsed: any = null;
        try {
            parsed = JSON.parse(text);
        } catch { }

        if (sheetStatus < 200 || sheetStatus >= 300 || parsed?.ok === false) {
            return NextResponse.json(
                {
                    error: "Failed to update sheet",
                    details: parsed?.crewSync?.error ?? parsed?.error ?? text,
                },
                { status: 502 }
            );
        }

        // The row now carries this Discord ID: expire cached members-sheet reads.
        invalidateMembersCache();

        // Sync turtle roles to Discord
        let discordResult: unknown = null;
        const guildId = process.env.DISCORD_GUILD_ID;
        const botToken = process.env.DISCORD_BOT_TOKEN;

        if (guildId && botToken && sessionDiscordId) {
            const turtleRoleIds = mergedTurtles
                .map((t) => resolveTurtleRoleId(t))
                .filter(Boolean) as string[];

            try {
                discordResult = await syncDiscordMember({
                    guildId,
                    botToken,
                    userId: sessionDiscordId,
                    turtleRoleIds,
                    crewRoleIds: [], // Claim doesn't set crews
                });
            } catch (e: unknown) {
                // Log but don't fail - sheet update succeeded
                console.error("Discord sync failed:", (e as any)?.message);
                discordResult = { ok: false, error: (e as any)?.message };
            }
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
                } else {
                }
            }).catch(err => {
            });
        } catch (err) {
            // Don't fail the claim if identity creation fails
        }

        return NextResponse.json({ ok: true, discord: discordResult });
    } catch (e: unknown) {
        return NextResponse.json({ error: (e as any)?.message || "Unknown error" }, { status: 500 });
    }
}
