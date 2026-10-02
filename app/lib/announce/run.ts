/**
 * Fire the Community Call announcement from the Next.js server:
 *
 *   1. Read the "Crews" tab (status block + Announcement table) with the
 *      Google service account.
 *   2. Build the same message the sheet's Apps Script builds.
 *   3. Post it to Discord directly (bot token or webhook) with 429 handling,
 *      and optionally to Telegram.
 *   4. Write Announce? / Last Sent: / Last Error: back to the sheet.
 *
 * No Google Apps Script is involved, so Discord's Cloudflare block on Apps
 * Script's shared egress IPs (429 / error 1015) can no longer break it.
 *
 * Server-side only.
 */

import { SHEET_IDS } from "@/app/lib/sheets/config";
import {
  postDiscordMessage,
  DiscordPostError,
  type DiscordTarget,
  type DiscordPostOptions,
} from "@/app/lib/discord-rest";
import {
  buildCommunityCallMessages,
  formatSheetTimestamp,
  normalizeForCrossPosting,
  parseSheetTimestamp,
} from "./message";
import { createAnnounceSheetIO, SENT_VALUE, type AnnounceSheetIO } from "./sheet";

/** Default: the #announcements channel the Apps Script posted to. */
export const DEFAULT_ANNOUNCE_CHANNEL_ID = "812143244149915679";
export const DEFAULT_ANNOUNCE_TIMEZONE = "America/New_York";
/** Refuse a second fire within this window of the last successful send. */
export const DOUBLE_FIRE_WINDOW_MS = 10 * 60 * 1000;

export interface AnnounceConfig {
  discord: DiscordTarget | null;
  telegram: { botToken: string; chatIds: string[] } | null;
  timeZone: string;
}

export function getAnnounceConfig(env: Record<string, string | undefined> = process.env): AnnounceConfig {
  const webhookUrl = env.ANNOUNCE_DISCORD_WEBHOOK_URL?.trim();
  const botToken = env.DISCORD_BOT_TOKEN?.trim();
  const channelId = (env.ANNOUNCE_DISCORD_CHANNEL_ID?.trim() || DEFAULT_ANNOUNCE_CHANNEL_ID).replace(/\D/g, "");

  let discord: DiscordTarget | null = null;
  if (webhookUrl) discord = { kind: "webhook", url: webhookUrl };
  else if (botToken) discord = { kind: "bot", channelId, botToken };

  const tgToken = env.ANNOUNCE_TELEGRAM_BOT_TOKEN?.trim();
  const tgChats = (env.ANNOUNCE_TELEGRAM_CHAT_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    discord,
    telegram: tgToken && tgChats.length ? { botToken: tgToken, chatIds: tgChats } : null,
    timeZone: env.ANNOUNCE_TIMEZONE?.trim() || DEFAULT_ANNOUNCE_TIMEZONE,
  };
}

export async function postToTelegram(
  cfg: { botToken: string; chatIds: string[] },
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const failures: string[] = [];
  for (const chatId of cfg.chatIds) {
    const res = await fetchImpl(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown", disable_web_page_preview: true }),
      cache: "no-store",
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = ((await res.json()) as { description?: string }).description ?? "";
      } catch {
        /* ignore */
      }
      failures.push(`chat ${chatId}: ${res.status}${detail ? ` ${detail}` : ""}`);
    }
  }
  if (failures.length) throw new Error(`Telegram failed for ${failures.join("; ")}`);
}

export interface AnnounceDeps {
  sheet: AnnounceSheetIO;
  config: AnnounceConfig;
  now?: () => Date;
  postDiscord?: typeof postDiscordMessage;
  postTelegram?: typeof postToTelegram;
  discordOptions?: DiscordPostOptions;
}

type ChannelResult = { success: true } | { success: false; error: string } | null;

export interface AnnounceResult {
  status: number;
  body: {
    success: boolean;
    error?: string;
    sentAt?: string;
    results?: { discord: ChannelResult; telegram: ChannelResult };
  };
}

// Best-effort in-instance guard against concurrent double clicks; the
// Last Sent window check covers separate serverless instances.
let inFlight = false;

export function __resetAnnounceLockForTests(): void {
  inFlight = false;
}

function errorText(err: unknown): string {
  if (err instanceof DiscordPostError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function runAnnouncement(deps: AnnounceDeps): Promise<AnnounceResult> {
  const now = deps.now ?? (() => new Date());
  const postDiscord = deps.postDiscord ?? postDiscordMessage;
  const postTg = deps.postTelegram ?? postToTelegram;
  const { config, sheet } = deps;

  if (!config.discord) {
    return {
      status: 500,
      body: {
        success: false,
        error: "Announcement is not configured: set DISCORD_BOT_TOKEN or ANNOUNCE_DISCORD_WEBHOOK_URL.",
      },
    };
  }

  if (inFlight) {
    return { status: 409, body: { success: false, error: "Already sending — please wait." } };
  }
  inFlight = true;

  try {
    let block;
    try {
      block = await sheet.readBlock();
    } catch (err) {
      console.error("[announce] failed to read sheet", err);
      return { status: 502, body: { success: false, error: `Could not read the announcement sheet: ${errorText(err)}` } };
    }

    const lastSentAt = parseSheetTimestamp(block.lastSentValue, config.timeZone);
    if (
      block.sendValue.toLowerCase() === SENT_VALUE.toLowerCase() &&
      lastSentAt &&
      now().getTime() - lastSentAt.getTime() >= 0 &&
      now().getTime() - lastSentAt.getTime() < DOUBLE_FIRE_WINDOW_MS
    ) {
      return {
        status: 409,
        body: {
          success: false,
          error: `Already sent at ${block.lastSentValue}. Wait ${DOUBLE_FIRE_WINDOW_MS / 60000} minutes before sending again.`,
        },
      };
    }

    const msgs = buildCommunityCallMessages(block.specials, now(), config.timeZone);

    const results: { discord: ChannelResult; telegram: ChannelResult } = { discord: null, telegram: null };
    try {
      await postDiscord(
        config.discord,
        { content: msgs.discord, allowed_mentions: { parse: ["everyone"] } },
        deps.discordOptions,
      );
      results.discord = { success: true };
    } catch (err) {
      results.discord = { success: false, error: errorText(err) };
    }

    if (config.telegram) {
      try {
        await postTg(config.telegram, normalizeForCrossPosting(msgs.telegram));
        results.telegram = { success: true };
      } catch (err) {
        results.telegram = { success: false, error: errorText(err) };
      }
    }

    const anySuccess = results.discord?.success === true || results.telegram?.success === true;
    const failures = [
      results.discord && !results.discord.success ? `❌ Discord: ${results.discord.error}` : null,
      results.telegram && !results.telegram.success ? `❌ Telegram: ${results.telegram.error}` : null,
    ].filter((x): x is string => Boolean(x));
    const errorSummary = failures.join("; ");
    const stamp = formatSheetTimestamp(now(), config.timeZone);

    // Status cells: mirror the Apps Script, but also clear a stale Last Error
    // after a clean send (the Apps Script never cleared it).
    const updates: Array<{ range: string; value: string }> = [];
    if (block.sendCell) updates.push({ range: block.sendCell, value: anySuccess ? SENT_VALUE : "" });
    if (anySuccess && block.lastSentCell) updates.push({ range: block.lastSentCell, value: stamp });
    if (block.lastErrorCell) {
      updates.push({
        range: block.lastErrorCell,
        value: failures.length ? `${errorSummary.slice(0, 500)}  [${stamp}]` : "",
      });
    }
    try {
      await sheet.writeCells(updates);
    } catch (err) {
      // The message already went out; report but don't pretend it failed.
      console.error("[announce] failed to update sheet status cells", err);
    }

    if (!anySuccess) {
      return { status: 502, body: { success: false, error: errorSummary, results } };
    }
    return {
      status: 200,
      body: {
        success: failures.length === 0,
        ...(failures.length ? { error: `Sent with errors: ${errorSummary}` } : {}),
        sentAt: stamp,
        results,
      },
    };
  } finally {
    inFlight = false;
  }
}

/** Production wiring. */
export function runAnnouncementFromEnv(): Promise<AnnounceResult> {
  return runAnnouncement({
    sheet: createAnnounceSheetIO(SHEET_IDS.announce),
    config: getAnnounceConfig(),
  });
}
