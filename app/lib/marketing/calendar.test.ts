// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetCalendarCache, eventsFromIcs, upcomingEvents } from "./calendar";

const NOW = new Date("2027-03-01T12:00:00Z");
const ics = (events: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", ...events, "END:VCALENDAR"].join("\r\n");
const one = (uid: string, start: string, end: string, extra = "") =>
  `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:20270101T000000Z\r\nDTSTART:${start}\r\nDTEND:${end}\r\nSUMMARY:Event ${uid}\r\nLOCATION:Somewhere\r\n${extra}END:VEVENT`;

describe("eventsFromIcs", () => {
  it("keeps one-off events inside the next 60 days, sorted, and drops past and far ones", () => {
    const text = ics([
      one("late", "20270320T180000Z", "20270320T190000Z"),
      one("soon", "20270302T180000Z", "20270302T190000Z"),
      one("past", "20270201T180000Z", "20270201T190000Z"),
      one("far", "20270701T180000Z", "20270701T190000Z"),
    ]);
    const events = eventsFromIcs(text, NOW);
    expect(events.map((e) => e.title)).toEqual(["Event soon", "Event late"]);
    expect(events[0]).toMatchObject({ location: "Somewhere", recurring: false, end: "2027-03-02T19:00:00.000Z" });
  });

  it("expands a weekly recurring event across the window", () => {
    const text = ics([one("weekly", "20270101T180000Z", "20270101T190000Z", "RRULE:FREQ=WEEKLY;BYDAY=FR\r\n")]);
    const events = eventsFromIcs(text, NOW);
    expect(events.length).toBeGreaterThanOrEqual(8);
    expect(events.every((e) => e.recurring)).toBe(true);
    expect(new Date(events[0].start).getTime()).toBeGreaterThanOrEqual(NOW.getTime());
  });
});

describe("upcomingEvents", () => {
  beforeEach(() => __resetCalendarCache());
  const feed = ics([one("a", "20270302T180000Z", "20270302T190000Z")]);
  const ok = () => vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => feed });

  it("caches the feed for 10 minutes", async () => {
    const f = ok();
    await upcomingEvents("https://x/a.ics", f as unknown as typeof fetch, NOW);
    await upcomingEvents("https://x/a.ics", f as unknown as typeof fetch, new Date(NOW.getTime() + 5 * 60_000));
    expect(f).toHaveBeenCalledTimes(1);
    await upcomingEvents("https://x/a.ics", f as unknown as typeof fetch, new Date(NOW.getTime() + 11 * 60_000));
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("serves the stale copy when the feed answers 429", async () => {
    await upcomingEvents("https://x/a.ics", ok() as unknown as typeof fetch, NOW);
    const throttled = vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "" });
    const events = await upcomingEvents("https://x/a.ics", throttled as unknown as typeof fetch, new Date(NOW.getTime() + 30 * 60_000));
    expect(events).toHaveLength(1);
  });

  it("throws on a failing feed with nothing cached", async () => {
    const bad = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "" });
    await expect(upcomingEvents("https://x/b.ics", bad as unknown as typeof fetch, NOW)).rejects.toThrow("500");
  });
});
