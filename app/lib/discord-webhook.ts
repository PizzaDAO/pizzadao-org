// app/lib/discord-webhook.ts

import { google } from "googleapis";

const WEBHOOK_SHEET_ID = "1bSLN2mL1K-qr3nLiURVjhm31Zxn0J3ta1Pq0txlXsPI";

// Initialize Google Sheets API client with service account
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];

let credentials;
try {
    credentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
        ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
        : undefined;
} catch (error) {
    console.error("[discord-webhook] Error parsing GOOGLE_SERVICE_ACCOUNT_JSON");
}

const auth = credentials
    ? new google.auth.GoogleAuth({ credentials, scopes: SCOPES })
    : null;

const sheets = auth ? google.sheets({ version: "v4", auth }) : null;

// Cache for webhook URLs (5 minute TTL)
const webhookCache = new Map<string, { url: string; time: number }>();
const CACHE_TTL = 5 * 60 * 1000;

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
        console.error("[discord-webhook] Google Sheets API not initialized - missing GOOGLE_SERVICE_ACCOUNT_JSON");
        return null;
    }

    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: WEBHOOK_SHEET_ID,
            range: "A:Z", // Get all columns
        });

        const rows = res.data.values || [];
        if (rows.length === 0) {
            console.error("[discord-webhook] Webhook sheet is empty");
            return null;
        }

        // First row is headers
        const headers = rows[0].map((h: string) => String(h || "").toLowerCase().trim());

        // Find column indices
        let channelColIdx = headers.findIndex((h: string) => h === "channel" || h === "crew");
        let webhookColIdx = headers.findIndex((h: string) => h === "webhook" || h === "webhook url" || h === "webhookurl");

        if (channelColIdx === -1 || webhookColIdx === -1) {
            console.error("[discord-webhook] Could not find Channel/Crew or Webhook columns. Headers:", headers);
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
                    console.log(`[discord-webhook] Found webhook for "${channelName}"`);
                    return webhook;
                }
            }
        }

        console.log(`[discord-webhook] No webhook found for channel "${channelName}"`);
        return null;
    } catch (error: any) {
        console.error("[discord-webhook] Error fetching webhook URL:", error?.message || error);
        return null;
    }
}

/**
 * Send a welcome message for a new member signup
 */
export async function sendWelcomeMessage(opts: {
    discordId: string;
    memberId: string;
    mafiaName: string;
    city?: string;
    topping?: string;
    mafiaMovie?: string;
    turtles?: string[];
    crews?: string[];
}): Promise<{ ok: boolean; error?: string }> {
    try {
        const webhookUrl = await getWebhookUrl("General");
        if (!webhookUrl) {
            return { ok: false, error: "Could not find General webhook URL" };
        }

        const { discordId, memberId, city, topping, mafiaMovie, turtles, crews } = opts;
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://onboarding.pizzadao.xyz";
        const profileUrl = `${baseUrl}/profile/${memberId}`;

        // Build the welcome message
        const lines: string[] = [];
        lines.push(`**Welcome to the Family, <@${discordId}>!**`);
        lines.push(`[View Profile](${profileUrl})`);
        lines.push("");

        if (city) {
            lines.push(`**City:** ${city}`);
        }

        if (topping) {
            lines.push(`**Favorite Pizza Topping:** ${topping}`);
        }

        if (mafiaMovie) {
            lines.push(`**Favorite Mafia Movie:** ${mafiaMovie}`);
        }

        if (turtles && turtles.length > 0) {
            lines.push(`**Roles:** ${turtles.join(", ")}`);
        }

        if (crews && crews.length > 0) {
            lines.push(`**Crews:** ${crews.join(", ")}`);
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
            console.error("[discord-webhook] Failed to send welcome message:", res.status, text);
            return { ok: false, error: `Discord webhook failed: ${res.status}` };
        }

        return { ok: true };
    } catch (error: any) {
        console.error("[discord-webhook] Error sending welcome message:", error);
        return { ok: false, error: error?.message || "Unknown error" };
    }
}
