/**
 * Wall-clock time in an IANA zone <-> UTC, with Intl only (no dependency). Used by the DST sync of
 * crew call times (plans/dst-crew-call-times.md).
 */

export const DEFAULT_CALL_TIME_ZONE = 'America/New_York'

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

export interface WallTime {
  year: number
  month: number // 1-12
  day: number
  hour: number
  minute: number
}

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function fmt(zone: string): Intl.DateTimeFormat {
  let f = fmtCache.get(zone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    })
    fmtCache.set(zone, f)
  }
  return f
}

/** The wall-clock date and time in `zone` at the instant `ms`. */
export function wallTimeIn(ms: number, zone: string): WallTime {
  const p: Record<string, number> = {}
  for (const part of fmt(zone).formatToParts(new Date(ms))) if (part.type !== 'literal') p[part.type] = Number(part.value)
  return { year: p.year, month: p.month, day: p.day, hour: p.hour % 24, minute: p.minute }
}

/** Offset (ms) of `zone` from UTC at the instant `ms` (positive east of UTC). */
function offsetAt(ms: number, zone: string): number {
  const w = wallTimeIn(ms, zone)
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) - Math.floor(ms / 60_000) * 60_000
}

/**
 * The UTC instant at which the clocks in `zone` read year-month-day hour:minute. The offset is
 * refined twice so a transition day resolves (a time inside the spring-forward gap lands just
 * after the gap; an ambiguous fall-back time gets one of its two instants).
 */
export function zonedWallTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, zone: string): number {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute)
  let guess = asUtc - offsetAt(asUtc, zone)
  guess = asUtc - offsetAt(guess, zone)
  return asUtc - offsetAt(guess, zone)
}

export function parseHHMM(s: string): { hour: number; minute: number } | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(s.trim())
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null
}

export function formatHHMM(w: Pick<WallTime, 'hour' | 'minute'>): string {
  return `${String(w.hour).padStart(2, '0')}:${String(w.minute).padStart(2, '0')}`
}
