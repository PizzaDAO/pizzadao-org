// app/lib/newsletter/sources/events.ts
//
// "Upcoming events": the guild's scheduled events (community and crew calls, education sessions are
// Discord events too) starting within the events window after the issue date. The monthly X Space is
// not a Discord event and never appears here (the invite block covers it). RSVPizza events plug in
// with phase 3.
import type { EventItem } from "../sections";

export interface RawGuildEvent {
  id?: string;
  name?: string;
  status?: number;
  scheduled_start_time?: string;
}

const oneLine = (s: string) => s.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").replace(/\s+/g, " ").trim();

/** Scheduled (status 1) events starting in (from, from + windowDays], soonest first. Pure. */
export function selectEvents(raw: RawGuildEvent[], from: Date, windowDays: number, guildId: string): EventItem[] {
  const end = from.getTime() + windowDays * 86_400_000;
  const out: Array<EventItem & { t: number }> = [];
  for (const e of raw) {
    const start = e.scheduled_start_time ? new Date(e.scheduled_start_time) : null;
    if (!start || Number.isNaN(start.getTime()) || e.status !== 1 || !e.name || !e.id) continue;
    const t = start.getTime();
    if (t <= from.getTime() || t > end) continue;
    out.push({
      id: `discord:${e.id}`,
      name: oneLine(e.name).slice(0, 200),
      startsAt: start.toISOString(),
      url: /^\d{15,25}$/.test(guildId) && /^\d{15,25}$/.test(e.id) ? `https://discord.com/events/${guildId}/${e.id}` : "",
      included: true,
      t,
    });
  }
  return out.sort((a, b) => a.t - b.t).map(({ t: _t, ...item }) => item);
}

export async function gatherEvents(
  from: Date,
  windowDays: number,
  o: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<EventItem[]> {
  const env = o.env ?? process.env;
  const token = env.DISCORD_BOT_TOKEN?.trim();
  const guild = env.DISCORD_GUILD_ID?.trim();
  if (!token || !guild) return [];
  try {
    const res = await (o.fetchImpl ?? fetch)(`https://discord.com/api/v10/guilds/${guild}/scheduled-events`, {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    return selectEvents((await res.json()) as RawGuildEvent[], from, windowDays, guild);
  } catch {
    return [];
  }
}
