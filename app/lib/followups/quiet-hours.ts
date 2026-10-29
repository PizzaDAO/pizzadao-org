/**
 * Quiet hours and the per-person daily cap. Pure functions of the clock, so they are unit-testable.
 * The recipient's timezone is an IANA id (MemberProfileExtras.timezone); unknown or invalid falls back to UTC.
 */

export function validTimezone(tz: string | null | undefined): string {
  if (!tz) return 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return 'UTC'
  }
}

/** True when `tz` is a real IANA zone (null, empty or invalid means unknown). */
export function isKnownTimezone(tz: string | null | undefined): boolean {
  return !!tz && validTimezone(tz) === tz
}

/** The hour (0-23) it is for `tz` at `now`. */
export function localHour(now: Date, tz: string | null | undefined): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: validTimezone(tz), hour: 'numeric', hourCycle: 'h23' }).formatToParts(now)
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  return h === 24 ? 0 : h
}

/** Whether `hour` falls in the quiet window [start, end). The window may wrap midnight; start === end means none. */
export function inQuietWindow(hour: number, start: number, end: number): boolean {
  if (start === end) return false
  return start < end ? hour >= start && hour < end : hour >= start || hour < end
}

export function isQuiet(now: Date, tz: string | null | undefined, start: number, end: number): boolean {
  return inQuietWindow(localHour(now, tz), start, end)
}

/** The first moment (on a 15 minute grid) at or after `now` that is outside quiet hours. */
export function nextAllowedTime(now: Date, tz: string | null | undefined, start: number, end: number): Date {
  if (!isQuiet(now, tz, start, end)) return now
  const step = 15 * 60_000
  // Snap to the next quarter hour, then walk forward (DST-safe, at most 24 hours).
  let t = Math.ceil(now.getTime() / step) * step
  for (let i = 0; i < 96; i++, t += step) {
    if (!isQuiet(new Date(t), tz, start, end)) return new Date(t)
  }
  return new Date(t)
}

export const DAY_MS = 24 * 3600 * 1000

/**
 * Daily cap: at most `max` messages in any rolling 24 hours. `sentAt` are the earlier send times to
 * this person. Returns ok, or when the window next has room.
 */
export function capDecision(sentAt: readonly Date[], now: Date, max: number): { ok: true } | { ok: false; retryAt: Date } {
  const recent = sentAt.filter((d) => now.getTime() - d.getTime() < DAY_MS).sort((a, b) => a.getTime() - b.getTime())
  if (recent.length < max) return { ok: true }
  // Room opens when the (recent.length - max + 1)-th oldest send leaves the window.
  const blocking = recent[recent.length - max]
  return { ok: false, retryAt: new Date(blocking.getTime() + DAY_MS) }
}
