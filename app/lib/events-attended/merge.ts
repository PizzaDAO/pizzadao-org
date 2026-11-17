/** Pure merge of the three sources into one list of rows (plans/profile-events-attended.md, step 4). */

export type EventBadge = 'attended' | 'ticket' | 'organizer'

export interface AttendedInput {
  id: string
  name: string
  date: Date | null
  city: string | null
  url: string | null
  guestListHidden: boolean
}

export interface TicketInput {
  id: string
  name: string
  year: number | null
  url: string | null
}

export interface OrganizerInput {
  id: string
  slug: string
  name: string
  date: Date | null
  city: string | null
  url: string | null
}

export interface EventRow {
  id: string
  name: string
  /** ISO date; null when unknown (tickets only carry a year). */
  date: string | null
  year: number | null
  city: string | null
  url: string | null
  badge: EventBadge
}

export const MAX_ROWS = 50

const norm = (s: string | null | undefined): string =>
  (s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** The rsv.pizza slug in a public event link, lower-cased; null for anything else. */
export function rsvSlug(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    if (u.hostname.toLowerCase().replace(/^www\./, '') !== 'rsv.pizza') return null
    return u.pathname.split('/').filter(Boolean)[0]?.toLowerCase() ?? null
  } catch {
    return null
  }
}

function sameTicketEvent(t: TicketInput, a: AttendedInput): boolean {
  const year = a.date?.getUTCFullYear() ?? null
  if (t.year === null || year === null || t.year !== year) return false
  const tn = norm(t.name)
  const an = norm(a.name)
  const city = norm(a.city)
  if (tn && an && (tn === an || tn.includes(an) || an.includes(tn))) return true
  return city.length >= 3 && tn.includes(city)
}

export function mergeEvents(
  input: { attended: AttendedInput[]; tickets: TicketInput[]; organizer: OrganizerInput[] },
  opts: { countTickets: boolean; viewerIsOwner: boolean; cap?: number },
): { events: EventRow[]; total: number } {
  // Hidden guest lists are only shown to the member themself.
  const attended = input.attended.filter((a) => opts.viewerIsOwner || !a.guestListHidden)
  const rows: EventRow[] = []
  const bySlug = new Map<string, EventRow>()

  for (const a of attended) {
    const row: EventRow = { id: `rsv:${a.id}`, name: a.name, date: a.date ? a.date.toISOString() : null, year: a.date ? a.date.getUTCFullYear() : null, city: a.city, url: a.url, badge: 'attended' }
    rows.push(row)
    const slug = rsvSlug(a.url)
    if (slug) bySlug.set(slug, row)
  }

  for (const o of input.organizer) {
    const slug = o.slug.toLowerCase()
    const hit = bySlug.get(slug)
    if (hit) {
      hit.badge = 'organizer'
      continue
    }
    const row: EventRow = { id: `org:${o.id}`, name: o.name, date: o.date ? o.date.toISOString() : null, year: o.date ? o.date.getUTCFullYear() : null, city: o.city, url: o.url, badge: 'organizer' }
    rows.push(row)
    bySlug.set(slug, row)
  }

  if (opts.countTickets) {
    for (const t of input.tickets) {
      const a = attended.find((x) => sameTicketEvent(t, x))
      if (a) continue // collapses into the Attended (or Organizer) row
      rows.push({ id: `tix:${t.id}`, name: t.name, date: null, year: t.year, city: null, url: t.url, badge: 'ticket' })
    }
  }

  rows.sort((a, b) => {
    const ay = a.year ?? -1
    const by = b.year ?? -1
    if (ay !== by) return by - ay
    const ad = a.date ? Date.parse(a.date) : -1
    const bd = b.date ? Date.parse(b.date) : -1
    return bd - ad || a.name.localeCompare(b.name)
  })
  return { events: rows.slice(0, opts.cap ?? MAX_ROWS), total: rows.length }
}
