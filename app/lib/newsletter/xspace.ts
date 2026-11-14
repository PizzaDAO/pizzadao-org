// app/lib/newsletter/xspace.ts
//
// The X Space invite block of an issue: a monthly Space at a fixed local time in a named time zone
// (default 4:20pm US Eastern, DST-aware through Intl). An issue dated on the Space day says "today";
// any other date says the date of the next Space. Pure; settings are read by xSpaceConfig().
import type { Settings } from "@/app/lib/settings";
import { resolveToggle } from "@/app/lib/settings/toggles";

export interface XSpaceConfig {
  enabled: boolean;
  localTime: string; // HH:MM, 24-hour
  timeZone: string; // IANA
  dayOfMonth: number;
  profileUrl: string;
}

export const DEFAULT_XSPACE: XSpaceConfig = { enabled: true, localTime: "16:20", timeZone: "America/New_York", dayOfMonth: 22, profileUrl: "" };

export function xSpaceConfig(settings: Settings): XSpaceConfig {
  return {
    enabled: resolveToggle("newsletter.xSpaceEnabled", settings),
    localTime: String(settings.get("newsletter.xSpaceLocalTime") ?? DEFAULT_XSPACE.localTime),
    timeZone: String(settings.get("newsletter.xSpaceTimeZone") ?? DEFAULT_XSPACE.timeZone),
    dayOfMonth: Number(settings.get("newsletter.xSpaceDayOfMonth") ?? DEFAULT_XSPACE.dayOfMonth),
    profileUrl: String(settings.get("newsletter.xProfileUrl") ?? ""),
  };
}

export interface XSpaceSection {
  enabled: boolean;
  headline: string;
  detail: string;
  url: string | null;
}

/** Calendar date of an instant in a time zone. */
export function zonedDate(at: Date, timeZone: string): { year: number; month: number; day: number } {
  const p = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(at);
  const n = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return { year: n("year"), month: n("month"), day: n("day") };
}

/** Offset (ms, local minus UTC) of a time zone at an instant. */
function offsetMs(at: Date, timeZone: string): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(at);
  const n = (t: string) => Number(p.find((x) => x.type === t)?.value);
  const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The UTC instant at which the wall clock in `timeZone` shows y-m-d hh:mm (DST-aware). */
export function zonedInstant(y: number, m: number, d: number, hh: number, mm: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - offsetMs(new Date(guess), timeZone);
  t = guess - offsetMs(new Date(t), timeZone);
  return new Date(t);
}

const clock12 = (hh: number, mm: number) => `${hh % 12 === 0 ? 12 : hh % 12}${mm ? `:${String(mm).padStart(2, "0")}` : ""}${hh < 12 ? "am" : "pm"}`;

/** When the Space happens for an issue dated `issueDate`: the Space day this month if it has not passed, else next month. */
export function nextSpace(issueDate: Date, cfg: XSpaceConfig): { start: Date; today: boolean } {
  const [hh, mm] = cfg.localTime.split(":").map(Number);
  const issue = zonedDate(issueDate, cfg.timeZone);
  let { year, month } = issue;
  if (issue.day > cfg.dayOfMonth) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return { start: zonedInstant(year, month, cfg.dayOfMonth, hh, mm, cfg.timeZone), today: issue.day === cfg.dayOfMonth };
}

export function buildXSpace(issueDate: Date, cfg: XSpaceConfig, spaceUrl: string | null | undefined): XSpaceSection {
  const { start, today } = nextSpace(issueDate, cfg);
  const [hh, mm] = cfg.localTime.split(":").map(Number);
  const zoneShort =
    new Intl.DateTimeFormat("en-US", { timeZone: cfg.timeZone, timeZoneName: "shortGeneric" }).formatToParts(start).find((x) => x.type === "timeZoneName")?.value ?? cfg.timeZone;
  const when = `${clock12(hh, mm)} ${zoneShort}`;
  const day = new Intl.DateTimeFormat("en-US", { timeZone: cfg.timeZone, weekday: "long", month: "long", day: "numeric" }).format(start);
  const utc = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(start);
  return {
    enabled: cfg.enabled,
    headline: today ? `Join our X Space today at ${when}` : `Join our X Space on ${day} at ${when}`,
    detail: `${when} is ${utc} UTC.`,
    url: spaceUrl?.trim() || cfg.profileUrl.trim() || null,
  };
}
