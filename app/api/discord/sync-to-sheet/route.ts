import { NextResponse } from "next/server";
import { ROLE_ID_TO_TURTLE } from "@/app/ui/constants";
import { writeToSheet } from "@/app/api/profile/route";

export const runtime = "nodejs";

const BASE_DISCORD_API = "https://discord.com/api/v10";

async function fetchDiscordMember(guildId: string, userId: string, botToken: string) {
    const res = await fetch(`${BASE_DISCORD_API}/guilds/${guildId}/members/${userId}`, {
        headers: { Authorization: `Bot ${botToken}` },
    });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Discord API error (${res.status}): ${txt}`);
    }
    return res.json();
}

async function fetchSheetData(req: Request, discordId: string) {
    const host = req.headers.get("host");
    const proto = req.headers.get("x-forwarded-proto") ?? "http";
    const baseUrl = `${proto}://${host}`;

    const res = await fetch(`${baseUrl}/api/member-lookup/${discordId}`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
}

export async function POST(req: Request) {
    try {
        const { discordId, memberId, mafiaName } = await req.json();

        if (!discordId) {
            return NextResponse.json({ error: "Missing discordId" }, { status: 400 });
        }

        const guildId = process.env.DISCORD_GUILD_ID;
        const botToken = process.env.DISCORD_BOT_TOKEN;
        const secret = process.env.GOOGLE_SHEETS_SHARED_SECRET;

        if (!guildId || !botToken || !secret) {
            return NextResponse.json({ error: "Missing env vars" }, { status: 500 });
        }

        // 1. Fetch from Discord
        const discordMember = await fetchDiscordMember(guildId, discordId, botToken);
        const discordRoleIds: string[] = discordMember.roles || [];

        // 2. Map Roles
        const discordTurtles: string[] = [];
        const otherRoleNames: string[] = [];

        // Iterate all roles to separate into Turtles vs Others
        // We need to fetch ALL guild roles to get names for "Other Roles"
        // Optimization: Only fetch guild roles if we have unmapped roles? 
        // Yes, let's fetch guild roles to get names.
        let guildRolesMap = new Map<string, string>(); // ID -> Name
        try {
            const rolesRes = await fetch(`${BASE_DISCORD_API}/guilds/${guildId}/roles`, {
                headers: { Authorization: `Bot ${botToken}` },
            });
            if (rolesRes.ok) {
                const rolesData = await rolesRes.json();
                rolesData.forEach((r: any) => guildRolesMap.set(r.id, r.name));
            }
        } catch (e) {
            console.error("Failed to fetch guild roles", e);
        }

        discordRoleIds.forEach(rId => {
            const turtleName = ROLE_ID_TO_TURTLE[rId];
            if (turtleName) {
                discordTurtles.push(turtleName);
            } else {
                const name = guildRolesMap.get(rId);
                if (name && name !== "@everyone") {
                    otherRoleNames.push(name);
                }
            }
        });

        // 3. Fetch Existing Sheet Data (to preserve existing Turtles that might not be in Discord?)
        // Actually, user said "Pulling roles in from discord shouldn't overwrite any existing roles... allow dedup"
        // So we fetch current sheet turtles.
        const sheetData = await fetchSheetData(req, discordId);

        // Normalize existing sheet turtles
        let existingTurtles: string[] = [];
        if (sheetData && sheetData.Turtles) {
            // "Leonardo, Donatello" -> ["Leonardo", "Donatello"]
            existingTurtles = String(sheetData.Turtles).split(",").map(s => s.trim()).filter(Boolean);
        }

        // 4. Merge & Dedup
        // We include existing sheet roles (to preserve manual entries), Discord turtles, AND other Discord roles.
        const finalRoles = Array.from(new Set([
            ...existingTurtles,
            ...discordTurtles,
            ...otherRoleNames
        ]));

        console.log("[Sync] Final Roles to Write:", finalRoles);
        console.log("[Sync] (Breakdown: Existing=", existingTurtles, "DiscordTurtles=", discordTurtles, "Other=", otherRoleNames, ")");

        // 5. Write back to Sheet
        // We need to construct a payload compatible with writeToSheet
        // We must pass minimal required fields to avoid validation error? 
        // My refactor removed strict validation on other fields, checks !!mafiaName.
        // We should use the name from sheet data if available

        const finalMafiaName = sheetData?.Name || mafiaName || discordMember.user?.username || "Unknown";
        const finalMemberId = sheetData?.ID || memberId;

        const payload = {
            secret,
            source: "discord-sync",
            discordId,
            memberId: finalMemberId,
            mafiaName: finalMafiaName, // Required by writeToSheet validation
            turtles: finalRoles,
            // explicitly verify these undefineds don't overwrite existing data in sheet script
            // script uses `raw.city ?? ""` but checks `if (raw.city !== undefined)` usually.
            // My script checks: `if (mapping.City && raw.city !== undefined)`
            // So if I exclude them from payload, they won't be overwritten.
            // `turtles` IS in payload, so it will be updated.
        };

        console.log("[Sync] Sending payload to Sheets:", JSON.stringify(payload));
        const writeRes = await writeToSheet(payload);
        console.log("[Sync] Write result:", writeRes);

        return NextResponse.json({
            ok: true,
            turtles: finalRoles,
            otherRoles: otherRoleNames,
            writeRes
        });

    } catch (error: any) {
        console.error("Sync error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
