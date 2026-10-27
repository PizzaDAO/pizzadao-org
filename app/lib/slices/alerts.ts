// Operator alerts for Call Slices (low balance, cap hit). Posted to the admin log
// channel with the existing Discord REST helper, at most once per 6 hours per run
// (throttled through SliceMintLease.lastAlertAt so serverless instances agree).
import { prisma } from "@/app/lib/db";
import { postDiscordMessage } from "@/app/lib/discord-rest";

export const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/** Best effort; returns true when a message was actually posted. Never throws. */
export async function postSliceAlert(message: string, now = new Date()): Promise<boolean> {
  try {
    const channelId = process.env.PEP_ADMIN_LOG_CHANNEL_ID?.trim();
    const botToken = process.env.DISCORD_BOT_TOKEN?.trim();
    // Claim the cooldown slot atomically: only one caller per window wins.
    const won = await prisma.sliceMintLease.updateMany({
      where: { id: 1, OR: [{ lastAlertAt: null }, { lastAlertAt: { lt: new Date(now.getTime() - ALERT_COOLDOWN_MS) } }] },
      data: { lastAlertAt: now },
    });
    if (won.count === 0) return false;
    if (!channelId || !botToken) {
      console.warn("[slices] alert (no Discord channel configured):", message);
      return false;
    }
    await postDiscordMessage(
      { kind: "bot", channelId, botToken },
      { content: `\u{1F355} Call Slices: ${message}`, allowed_mentions: { parse: [] } },
    );
    return true;
  } catch (e) {
    console.error("[slices] alert failed:", e instanceof Error ? e.message : e);
    return false;
  }
}
