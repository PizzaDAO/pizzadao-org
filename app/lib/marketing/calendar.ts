// The community calendar for the marketing pages: reads a public Google Calendar iCal feed and
// returns the next 60 days of events, recurring ones expanded. Ported from the old hosted function.
import ical from "node-ical";

export interface CalendarEvent {
  start: string;
  end: string | null;
  title: string;
  location: string;
  description: string;
  recurring: boolean;
}

const CACHE_TTL_MS = 10 * 60 * 1000; // fresh for 10 minutes
const STALE_TTL_MS = 6 * 60 * 60 * 1000; // served stale for up to 6 hours when Google throttles (429)
const HORIZON_MS = 60 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

// Warm-instance cache: Google rate limits the feed hard.
let cache: { url: string; at: number; text: string } | null = null;

export function __resetCalendarCache() {
  cache = null;
}

async function loadFeed(url: string, fetchImpl: typeof fetch, now: number): Promise<string> {
  if (cache && cache.url === url && now - cache.at < CACHE_TTL_MS) return cache.text;
  const res = await fetchImpl(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      // A browser-ish agent is treated more kindly than the default one.
      "User-Agent": "Mozilla/5.0 (compatible; PizzaDAO-Calendar/1.0; +https://pizzadao.org)",
      Accept: "text/calendar, text/plain, */*",
    },
  });
  if (res.status === 429 && cache && cache.url === url && now - cache.at < STALE_TTL_MS) return cache.text;
  if (!res.ok) throw new Error(`ICS fetch failed: ${res.status}`);
  const text = await res.text();
  cache = { url, at: now, text };
  return text;
}

export function eventsFromIcs(text: string, now: Date): CalendarEvent[] {
  const parsed = ical.parseICS(text);
  const horizon = new Date(now.getTime() + HORIZON_MS);
  const events: CalendarEvent[] = [];
  for (const k of Object.keys(parsed)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ev: any = parsed[k];
    if (!ev || ev.type !== "VEVENT") continue;
    const recurring = !!ev.rrule;
    const push = (start: Date, end: Date | null) =>
      events.push({
        start: start.toISOString(),
        end: end ? end.toISOString() : null,
        title: (ev.summary || "").toString(),
        location: (ev.location || "").toString(),
        description: (ev.description || "").toString(),
        recurring,
      });
    if (ev.rrule) {
      const dates: Date[] = ev.rrule.between(now, horizon, true);
      const duration = ev.end && ev.start ? ev.end.getTime() - ev.start.getTime() : 0;
      for (const d of dates) {
        const orig = ev.start as Date;
        const occ = new Date(d);
        occ.setHours(orig.getHours(), orig.getMinutes(), 0, 0);
        if (ev.exdate) {
          const key = occ.toISOString().slice(0, 10);
          const skip = Object.keys(ev.exdate).some((ek) => new Date(ev.exdate[ek]).toISOString().slice(0, 10) === key);
          if (skip) continue;
        }
        push(occ, duration ? new Date(occ.getTime() + duration) : null);
      }
    } else if (ev.start) {
      const start = ev.start as Date;
      if (start >= now && start <= horizon) push(start, ev.end ?? null);
    }
  }
  return events.sort((a, b) => a.start.localeCompare(b.start));
}

/** Upcoming events from the feed. Throws when the feed cannot be read. */
export async function upcomingEvents(url: string, fetchImpl: typeof fetch = fetch, now: Date = new Date()): Promise<CalendarEvent[]> {
  const text = await loadFeed(url, fetchImpl, now.getTime());
  return eventsFromIcs(text, now);
}
