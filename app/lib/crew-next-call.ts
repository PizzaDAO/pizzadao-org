const ZONES: Record<string, string> = { ET: "America/New_York", PT: "America/Los_Angeles", CT: "America/Chicago", MT: "America/Denver", UTC: "UTC", GMT: "UTC" };
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
function parts(date: Date, timeZone: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(date).map(p => [p.type, p.value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute };
}
/** Only calculate dates for an explicit, supported weekly schedule and timezone. */
export function nextCrewCall(schedule: string | undefined, now = new Date()): Date | null {
  if (!schedule) return null;
  const dayMatch = schedule.match(/\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)s?\b/i);
  const time = schedule.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  const zone = schedule.match(/\b(ET|PT|CT|MT|UTC|GMT)\b/);
  if (!dayMatch || !time || !zone || +time[1] < 1 || +time[1] > 12 || +(time[2] || 0) > 59) return null;
  const timeZone = ZONES[zone[1]];
  const hour = +time[1] % 12 + (time[3].toLowerCase() === "pm" ? 12 : 0);
  const minute = +(time[2] || 0);
  const today = parts(now, timeZone);
  for (let offset = 0; offset <= 14; offset++) {
    const day = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
    if (day.getUTCDay() !== DAYS.indexOf(dayMatch[1].toLowerCase())) continue;
    const target = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute);
    let candidate = target;
    for (let i = 0; i < 4; i++) {
      const local = parts(new Date(candidate), timeZone);
      candidate += target - Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
    }
    const roundTrip = parts(new Date(candidate), timeZone);
    if (candidate > now.getTime() && roundTrip.hour === hour && roundTrip.minute === minute && roundTrip.day === day.getUTCDate()) return new Date(candidate);
  }
  return null;
}
export function calendarDownload(label: string, start: Date, durationMinutes: number, url: string) {
  const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const escape = (s: string) => s.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/[,;]/g, "\\$&");
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//PizzaDAO//Crew Calls//EN", "BEGIN:VEVENT", `UID:${start.getTime()}-${encodeURIComponent(label)}@pizzadao.org`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(new Date(start.getTime() + durationMinutes * 60000))}`, `SUMMARY:${escape(label)}`, `DESCRIPTION:${escape(url)}`, "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}
