// app/lib/discord-webhook.ts

import { google } from "googleapis";
import { getCrewMappings } from "./crew-mappings";
import { SHEET_IDS } from "./sheets/config";
import { getGoogleAuth, GOOGLE_SCOPES, hasServiceAccountCredentials } from "./google-auth";

const WEBHOOK_SHEET_ID = SHEET_IDS.discordWebhooks;

// Google Sheets API client with the shared service account. Webhooks are
// optional: without valid credentials getWebhookUrl() returns null.
const sheets = hasServiceAccountCredentials()
    ? google.sheets({ version: "v4", auth: getGoogleAuth([GOOGLE_SCOPES.sheetsReadonly]) })
    : null;

// Cache for webhook URLs (5 minute TTL)
const webhookCache = new Map<string, { url: string; time: number }>();
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Convert crew IDs to display labels using the crew-mappings module
 */
async function formatCrewNames(crewIds: string[]): Promise<string[]> {
    try {
        const { crews } = await getCrewMappings();
        const labelMap = new Map(crews.map(c => [c.id.toLowerCase(), c.label]));
        return crewIds.map(id => labelMap.get(id.toLowerCase().trim()) || id);
    } catch {
        return crewIds;
    }
}

/**
 * Fetch a Discord webhook URL from the webhooks sheet by channel name
 */
export async function getWebhookUrl(channelName: string): Promise<string | null> {
    const cacheKey = channelName.toLowerCase();
    const cached = webhookCache.get(cacheKey);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
        return cached.url;
    }

    if (!sheets) {
        return null;
    }

    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: WEBHOOK_SHEET_ID,
            range: "A:Z", // Get all columns
        });

        const rows = res.data.values || [];
        if (rows.length === 0) {
            return null;
        }

        // First row is headers
        const headers = rows[0].map((h: string) => String(h || "").toLowerCase().trim());

        // Find column indices
        const channelColIdx = headers.findIndex((h: string) => h === "channel" || h === "crew");
        const webhookColIdx = headers.findIndex((h: string) => h === "webhook" || h === "webhook url" || h === "webhookurl");

        if (channelColIdx === -1 || webhookColIdx === -1) {
            return null;
        }

        // Search for the channel in data rows
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const channel = String(row[channelColIdx] || "").trim();
            if (channel.toLowerCase() === channelName.toLowerCase()) {
                const webhook = String(row[webhookColIdx] || "").trim();
                if (webhook) {
                    webhookCache.set(cacheKey, { url: webhook, time: Date.now() });
                    return webhook;
                }
            }
        }

        return null;
    } catch (error: any) {
        return null;
    }
}

/**
 * Send a welcome/update message for member signup or profile update
 */
export async function sendWelcomeMessage(opts: {
    discordId: string;
    memberId: string;
    mafiaName: string;
    city?: string;
    topping?: string;
    mafiaMovie?: string;
    mediaType?: "movie" | "tv";
    turtles?: string[];
    crews?: string[];
    isNewSignup?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
    try {
        const webhookUrl = await getWebhookUrl("General");
        if (!webhookUrl) {
            return { ok: false, error: "Could not find General webhook URL" };
        }

        const { discordId, memberId, city, topping, mafiaMovie, mediaType, turtles, crews, isNewSignup = true } = opts;
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://app.pizzadao.org";
        const profileUrl = `${baseUrl}/profile/${memberId}`;

        // Build the message with different greeting for new vs returning members
        const lines: string[] = [];
        const greeting = isNewSignup
            ? `**Welcome to the Family, <@${discordId}>!**`
            : `**Good to see you, <@${discordId}>!**`;
        lines.push(greeting);
        lines.push(`[View Profile](${profileUrl})`);
        lines.push("");

        if (city) {
            lines.push(`**City:** ${city}`);
        }

        if (topping) {
            lines.push(`**Favorite Pizza Topping:** ${topping}`);
        }

        if (mafiaMovie) {
            const label = mediaType === "tv"
                ? "Favorite Mafia TV Show"
                : "Favorite Mafia Movie";
            lines.push(`**${label}:** ${mafiaMovie}`);
        }

        if (turtles && turtles.length > 0) {
            lines.push(`**Roles:** ${turtles.join(", ")}`);
        }

        if (crews && crews.length > 0) {
            const crewLabels = await formatCrewNames(crews);
            lines.push(`**Crews:** ${crewLabels.join(", ")}`);
        }

        const content = lines.join("\n");

        const res = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                content,
                allowed_mentions: {
                    users: [discordId],
                },
            }),
        });

        if (!res.ok) {
            const text = await res.text();
            return { ok: false, error: `Discord webhook failed: ${res.status}` };
        }

        return { ok: true };
    } catch (error: any) {
        return { ok: false, error: error?.message || "Unknown error" };
    }
}
