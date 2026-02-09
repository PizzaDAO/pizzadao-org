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
}

const auth = credentials
    ? new google.auth.GoogleAuth({ credentials, scopes: SCOPES })
    : null;

const sheets = auth ? google.sheets({ version: "v4", auth }) : null;

// Cache for webhook URLs (5 minute TTL)
const webhookCache = new Map<string, { url: string; time: number }>();
const CACHE_TTL = 5 * 60 * 1000;

// Cache for crew mappings (id -> label)
let crewLabelCache: { time: number; data: Map<string, string> } | null = null;
const CREW_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Fetch crew ID -> label mapping from the crew mappings sheet
 */
async function getCrewLabels(): Promise<Map<string, string>> {
    if (crewLabelCache && Date.now() - crewLabelCache.time < CREW_CACHE_TTL) {
        return crewLabelCache.data;
    }

    const labelMap = new Map<string, string>();

    try {
        // Use the same sheet as crew-mappings API
        const CREW_MAPPINGS_SHEET_ID = "1bSLN2mL1K-qr3nLiURVjhm31Zxn0J3ta1Pq0txlXsPI";

        if (!sheets) {
            return labelMap;
        }

        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: CREW_MAPPINGS_SHEET_ID,
            range: "Crews!A:Z",
        });

        const rows = res.data.values || [];
        if (rows.length === 0) return labelMap;

        // Find header indices
        const headers = rows[0].map((h: string) => String(h || "").toLowerCase().trim());
        const idIdx = headers.findIndex((h: string) => h === "id" || h === "crew id");
        const labelIdx = headers.findIndex((h: string) => h === "crew" || h === "label" || h === "name");

        if (idIdx === -1 || labelIdx === -1) {
            // Fallback: assume id in col 0, label in col 1
            for (let i = 1; i < rows.length; i++) {
                const id = String(rows[i][0] || "").trim().toLowerCase();
                const label = String(rows[i][1] || "").trim();
                if (id && label) labelMap.set(id, label);
            }
        } else {
            for (let i = 1; i < rows.length; i++) {
                const id = String(rows[i][idIdx] || "").trim().toLowerCase();
                const label = String(rows[i][labelIdx] || "").trim();
                if (id && label) labelMap.set(id, label);
            }
        }

        crewLabelCache = { time: Date.now(), data: labelMap };
    } catch (error: any) {
    }

    return labelMap;
}

/**
 * Convert crew IDs to display labels
 */
async function formatCrewNames(crewIds: string[]): Promise<string[]> {
    const labelMap = await getCrewLabels();
    return crewIds.map(id => {
        const normalizedId = id.toLowerCase().trim();
        return labelMap.get(normalizedId) || id; // Fallback to original if not found
    });
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
        let channelColIdx = headers.findIndex((h: string) => h === "channel" || h === "crew");
        let webhookColIdx = headers.findIndex((h: string) => h === "webhook" || h === "webhook url" || h === "webhookurl");

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
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://pizzadao.org";
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
