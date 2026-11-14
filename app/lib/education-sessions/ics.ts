/**
 * An iCalendar (.ics) file for one public session, for "Add to calendar". Pure: RFC 5545 text with
 * CRLF line ends, escaped text values and lines folded at 75 octets. Times are UTC, so every
 * calendar app shows them in the reader's own zone.
 */
export interface IcsSession {
  id: string
  title: string
  presenter: string | null
  description: string
  startsAt: Date
  endsAt: Date
  url: string | null
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')

// Control characters other than tab, CR and LF (those two are handled as line breaks where text allows them).
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

/** A value that may not contain a line break at all (UID, URL): control characters and breaks removed. */
export const icsPlain = (v: string): string => v.replace(/[\r\n]/g, '').replace(CONTROL, '')

/** Escape a TEXT value: control characters dropped, backslash, semicolon, comma escaped, CRLF / CR / LF become \\n. */
export function icsEscape(v: string): string {
  return v
    .replace(CONTROL, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

/** Fold a content line to at most 75 octets per physical line (continuations start with one space). */
export function icsFold(line: string): string {
  const enc = new TextEncoder()
  const out: string[] = []
  let cur = ''
  let bytes = 0
  let limit = 75
  for (const ch of line) {
    const n = enc.encode(ch).length
    if (bytes + n > limit) {
      out.push(cur)
      cur = ' '
      bytes = 1
      limit = 75
    }
    cur += ch
    bytes += n
  }
  out.push(cur)
  return out.join('\r\n')
}

export function buildIcs(s: IcsSession, opts: { host: string; now?: Date } = { host: 'pizzadao.org' }): string {
  const description = [s.presenter ? `Presented by ${s.presenter}` : '', s.description, s.url ?? ''].filter(Boolean).join('\n\n')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PizzaDAO//Sessions//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${icsPlain(`session-${s.id}@${opts.host}`)}`,
    `DTSTAMP:${stamp(opts.now ?? new Date())}`,
    `DTSTART:${stamp(s.startsAt)}`,
    `DTEND:${stamp(s.endsAt)}`,
    `SUMMARY:${icsEscape(s.title)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    ...(s.url ? [`URL:${icsPlain(s.url)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(icsFold).join('\r\n') + '\r\n'
}
