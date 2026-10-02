// app/api/auto-claim/route.ts
// Handles auto-claiming when Discord nickname matches a member name
// No password required since we verify via session + name match
import { fetchWithRedirect } from "@/app/lib/sheet-utils";
import {
    MEMBER_COLUMNS,
    cellText,
    findMemberRow,
    getMembersTable,
    invalidateMembersCache,
    membersColumn,
} from "@/app/lib/sheets/member-repository";
import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { getDiscordTurtleRoles, mergeTurtles, parseTurtlesFromSheet } from "@/app/lib/discord-roles";
import { syncDiscordMember } from "@/app/lib/services/discord-api";
import { TURTLE_ROLE_IDS } from "@/app/ui/constants";
import { internalError } from "@/app/lib/errors/error-response";

export const runtime = "nodejs";

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

        // Fetch the member data to verify name match. Uncached on purpose: the
        // "already claimed?" check below must see the row's current Discord ID
        // before we write to it.
        const sheet = await getMembersTable({ fresh: true }).catch(() => {
            throw new Error("Failed to fetch sheet");
        });

        if (sheet.headerRowIndex === -1) {
            return NextResponse.json({ error: "Header row not found" }, { status: 500 });
        }

        const idxName = membersColumn(sheet, MEMBER_COLUMNS.name);
        const idxDiscord = membersColumn(sheet, MEMBER_COLUMNS.discordId);
        const idxTurtles = membersColumn(sheet, ["turtles", "roles"]);

        if (idxName == null) {
            return NextResponse.json({ error: "Name column not found" }, { status: 500 });
        }

        // Find the member row
        const row = findMemberRow(sheet, String(memberId));
        if (row) {
            const cells = row.c || [];
            const memberName = cellText(cells[idxName]);
            const existingDiscord = idxDiscord != null ? cellText(cells[idxDiscord]) : "";

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

            const { status: sheetStatus, text: sheetText } = await fetchWithRedirect(url, payload);

            let parsed: any = null;
            try {
                parsed = JSON.parse(sheetText);
            } catch { }

            if (sheetStatus < 200 || sheetStatus >= 300 || parsed?.ok === false) {
                return NextResponse.json({
                    error: "Failed to update sheet",
                    details: parsed?.crewSync?.error ?? parsed?.error ?? sheetText,
                }, { status: 502 });
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
                        crewRoleIds: [], // Auto-claim doesn't set crews
                    });
                } catch (e: unknown) {
                    // Log but don't fail - sheet update succeeded
                    console.error("Discord sync failed:", (e as any)?.message);
                    discordResult = { ok: false, error: "Discord sync failed" };
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
        }

        return NextResponse.json({ error: `Member ID ${memberId} not found` }, { status: 404 });
    } catch (e: unknown) {
        return internalError(e, "auto-claim", "Failed to claim member");
    }
}
