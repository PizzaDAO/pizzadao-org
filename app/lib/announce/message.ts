/**
 * Pure helpers that build the Community Call announcement text.
 *
 * Ported 1:1 from the "Community Call Announcement" Apps Script bound to the
 * Crew sheet (`buildCommunityCallMessages_`, `getSundaySpecials_` and friends)
 * so the text posted from the Next.js server matches what the sheet's own
 * "Announce?" -> "Send" flow posts.
 */

/** One "to do"/"redo" row from the Announcement table on the Crews tab. */
export interface AnnouncementSpecial {
  text: string;
  /** Hyperlink on the cell (rich text link or HYPERLINK() formula), if any. */
  url: string | null;
  crew: string;
  status: string;
}

export const CREW_EMOJI_MAP: Record<string, string> = {
  education: "🎓",
  ops: "🫡",
  events: "🥳",
  "biz dev": "🤝",
  bizdev: "🤝",
  comms: "🗣",
  tech: "💻",
  creative: "✍",
};

/** Statuses (case-insensitive) that put a row into "Sunday's Specials". */
const SPECIAL_STATUSES = new Set(["to do", "redo"]);

export const DISCORD_EVENT_URL =
  "https://discord.com/events/812097286003359764/1394277100503961742";

/** Escape characters that would break a Discord masked link's [text]. */
export function escapeDiscordLinkText(text: string): string {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

/** Extract the URL from a `=HYPERLINK("url", "label")` formula. */
export function parseHyperlinkFormula(formula: string | null | undefined): string | null {
  if (!formula) return null;
  const f = formula.trim();
  const m = f.match(/^=HYPERLINK\(\s*"([^"]+)"\s*[,;]\s*(.+)\)\s*$/i);
  return m ? m[1] || null : null;
}

/** Render the specials lines ("<emoji> <text or [text](url)>"). */
export function renderSpecials(rows: AnnouncementSpecial[]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const text = (row.text || "").trim();
    const status = (row.status || "").trim().toLowerCase();
    if (!text || !SPECIAL_STATUSES.has(status)) continue;
    const emoji = CREW_EMOJI_MAP[(row.crew || "").trim().toLowerCase()] || "🍕";
    const rendered = row.url ? `[${escapeDiscordLinkText(text)}](${row.url})` : text;
    out.push(`${emoji} ${rendered}`);
  }
  return out;
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `yyyy-MM-dd HH:mm:ss` in the given time zone (same format Apps Script wrote). */
export function formatSheetTimestamp(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/**
 * Parse a `yyyy-MM-dd HH:mm:ss` wall-clock stamp in `timeZone` back to an
 * instant. Returns null when the text is not in that format.
 */
export function parseSheetTimestamp(text: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec((text || "").trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  // Offset of the zone at (approximately) that instant.
  const p = zonedParts(new Date(asUtc), timeZone);
  const zonedAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offset = zonedAsUtc - asUtc;
  return new Date(asUtc - offset);
}

/** "Sunday, October 4": today if it is Sunday in `timeZone`, else the next Sunday. */
export function upcomingSundayLabel(now: Date, timeZone: string): string {
  const p = zonedParts(now, timeZone);
  const local = new Date(Date.UTC(p.year, p.month - 1, p.day, 12));
  local.setUTCDate(local.getUTCDate() + ((7 - local.getUTCDay()) % 7));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(local);
}

/** Collapse odd whitespace before cross-posting (Telegram). */
export function normalizeForCrossPosting(text: string): string {
  return String(text)
    .replace(/\r\n/g, "\n")
    .replace(/[  -​  　]/g, " ")
    .replace(/﻿/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function buildCommunityCallMessages(
  specials: AnnouncementSpecial[],
  now: Date,
  timeZone: string,
): { discord: string; telegram: string; specialsCount: number } {
  const sundayLabel = upcomingSundayLabel(now, timeZone);
  const lines = renderSpecials(specials);
  const specialsBlock = lines.length
    ? lines.join("\n")
    : `🔸\n  (No "to do" / "redo" specials found in the Announcement table.)`;

  const discord = `🍕 🤙 Community Call ${sundayLabel} on Pizza Hacking Radio! 🤙🍕

🌞 10am PDT / 1pm EDT / 7pm CDT 🌕

Sunday's Specials:
${specialsBlock}

Sunday's Menu:
🤝 Intro to PizzaDAO
👩‍🍳 Trainee Onboarding
📆 Events
👨‍💻 Hackathons
🧠 Specials
🏴‍☠️ Crew Updates
💰 Treasury update
🗳️ Proposals
🎟️ Raffle

Holders, join us in the Back Room after the call.

${DISCORD_EVENT_URL}

@everyone  @here`;

  const telegram = `🍕 🤙 Community Call ${sundayLabel} on https://discord.pizzadao.xyz 🤙🍕
🌞 10am PDT / 1pm EDT / 7pm CDT 🌕

Sunday's Specials:
${specialsBlock}

Sunday's Menu:
🤝 Intro to PizzaDAO
👩‍🍳 Trainee Onboarding
📆 Events
👨‍💻 Hackathons
🏴‍☠️ Crew Updates
💰 Treasury
🗳️ Proposals
🧠 Specials
🎟️ Raffle

Holders, join us in the Back Room after the call.`;

  return { discord, telegram, specialsCount: lines.length };
}
