// app/lib/discord-roles.ts
// Helper functions for fetching and mapping Discord roles to turtles

import { ROLE_ID_TO_TURTLE } from "@/app/ui/constants";

const API_BASE = "https://discord.com/api/v10";

/**
 * Fetch a Discord guild member's data including their roles
 */
export async function fetchDiscordMemberRoles(discordId: string): Promise<string[]> {
    const botToken = process.env.DISCORD_BOT_TOKEN;
    const guildId = process.env.DISCORD_GUILD_ID;

    if (!botToken || !guildId) {
        console.warn("[discord-roles] Missing DISCORD_BOT_TOKEN or DISCORD_GUILD_ID");
        return [];
    }

    try {
        const res = await fetch(`${API_BASE}/guilds/${guildId}/members/${discordId}`, {
            headers: {
                Authorization: `Bot ${botToken}`,
            },
            cache: "no-store",
        });

        if (!res.ok) {
            console.warn(`[discord-roles] Failed to fetch member ${discordId}: ${res.status}`);
            return [];
        }

        const member = await res.json();
        return member.roles || [];
    } catch (e) {
        console.error("[discord-roles] Error fetching member roles:", e);
        return [];
    }
}

/**
 * Convert Discord role IDs to turtle names
 * Returns array like ["Leonardo", "Raphael"]
 */
export function rolesToTurtleNames(roleIds: string[]): string[] {
    const turtles: string[] = [];
    for (const roleId of roleIds) {
        const turtleName = ROLE_ID_TO_TURTLE[roleId];
        if (turtleName) {
            turtles.push(turtleName);
        }
    }
    return turtles;
}

/**
 * Fetch Discord member roles and return turtle names
 */
export async function getDiscordTurtleRoles(discordId: string): Promise<string[]> {
    const roleIds = await fetchDiscordMemberRoles(discordId);
    return rolesToTurtleNames(roleIds);
}

/**
 * Merge existing turtles with new turtles, deduplicating (case-insensitive)
 */
export function mergeTurtles(existing: string[], newTurtles: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    // Helper to normalize turtle names for comparison
    const normalize = (t: string) => t.trim().toLowerCase();

    // Add existing first
    for (const t of existing) {
        const norm = normalize(t);
        if (norm && !seen.has(norm)) {
            seen.add(norm);
            result.push(t.trim());
        }
    }

    // Add new ones (use proper casing from ROLE_ID_TO_TURTLE)
    for (const t of newTurtles) {
        const norm = normalize(t);
        if (norm && !seen.has(norm)) {
            seen.add(norm);
            result.push(t.trim());
        }
    }

    return result;
}

/**
 * Parse a turtles string/array from the sheet into an array
 */
export function parseTurtlesFromSheet(value: any): string[] {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    if (typeof value === "string") {
        return value.split(/[,|]+/).map(s => s.trim()).filter(Boolean);
    }
    return [];
}
