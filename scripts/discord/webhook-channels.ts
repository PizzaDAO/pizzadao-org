/**
 * Read-only: resolve each Discord webhook in the `discordWebhooks` Google Sheet to the channel
 * it posts to, so the discord.*ChannelId settings can be filled in. Prints "purpose -> channel id"
 * only (never the webhook token). Uses GET /webhooks/{id}/{token}, which changes nothing.
 *
 * Run: npx tsx scripts/discord/webhook-channels.ts   (needs the Google service account env)
 */
import { google } from "googleapis";
import { SHEET_IDS } from "../../app/lib/sheets/config";
import { getGoogleAuth, GOOGLE_SCOPES } from "../../app/lib/google-auth";

const WEBHOOK_RE = /\/webhooks\/(\d+)\/([\w-]+)/;

async function main() {
    const sheets = google.sheets({ version: "v4", auth: getGoogleAuth([GOOGLE_SCOPES.sheetsReadonly]) });
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_IDS.discordWebhooks, range: "A:Z" });
    const rows = res.data.values || [];
    if (rows.length === 0) {
        console.log("No rows in the webhooks sheet.");
        return;
    }
    const headers = rows[0].map((h: unknown) => String(h || "").toLowerCase().trim());
    const nameIdx = headers.findIndex((h: string) => h === "channel" || h === "crew");
    const hookIdx = headers.findIndex((h: string) => h === "webhook" || h === "webhook url" || h === "webhookurl");
    if (nameIdx === -1 || hookIdx === -1) throw new Error("Could not find the channel/webhook columns.");

    for (const row of rows.slice(1)) {
        const purpose = String(row[nameIdx] || "").trim();
        const m = WEBHOOK_RE.exec(String(row[hookIdx] || ""));
        if (!purpose || !m) continue;
        try {
            const r = await fetch(`https://discord.com/api/v10/webhooks/${m[1]}/${m[2]}`);
            if (!r.ok) {
                console.log(`${purpose} -> (lookup failed: ${r.status})`);
                continue;
            }
            const j = (await r.json()) as { channel_id?: string };
            console.log(`${purpose} -> ${j.channel_id ?? "(no channel id)"}`);
        } catch (e) {
            console.log(`${purpose} -> (lookup error: ${e instanceof Error ? e.message : "unknown"})`);
        }
    }
}

main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
