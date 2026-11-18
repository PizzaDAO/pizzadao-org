import { DEFAULT_CALL_TIME_ZONE } from './zoned-time'

/**
 * Call dates and times are shown in the call time zone (Eastern by default), never the server's
 * zone (UTC on Vercel). Times carry a zone label (e.g. "EST"); date-only values use the same zone
 * so an evening call doesn't land on the next day.
 */
export function callDateTimeFormat(
  locale: string,
  opts: { month?: 'short' | 'long'; timeZone?: string } = {},
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, {
    month: opts.month ?? 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone: opts.timeZone ?? DEFAULT_CALL_TIME_ZONE,
  })
}

export function callDateFormat(locale: string, opts: { timeZone?: string } = {}): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: opts.timeZone ?? DEFAULT_CALL_TIME_ZONE,
  })
}
