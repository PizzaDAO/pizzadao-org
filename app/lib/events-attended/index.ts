/**
 * Read side of Events attended. Database reads only (no rsv.pizza call), run in parallel:
 * stored rsv.pizza check-ins, Unlock tickets, and approved Bitcoin Pizza Day host missions.
 */
import { prisma } from '@/app/lib/db'
import { disavowEnabled } from '@/app/lib/disavow/constants'
import { isDisavowSubject } from '@/app/lib/disavow/access'
import { getTicketSummary } from '@/app/lib/unlock/scan'
import { mergeEvents, type AttendedInput, type OrganizerInput, type TicketInput, type EventRow } from './merge'

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function parseDate(v: unknown): Date | null {
  const s = str(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Approved `gpp_host` completions; the verifier stored slug, name, city and date in checkResult. */
async function loadOrganizer(memberId: string, discordId: string): Promise<OrganizerInput[]> {
  const rows = await prisma.missionCompletion.findMany({
    where: { status: 'APPROVED', mission: { verifierKey: 'gpp_host' }, OR: [{ memberId }, { discordId }] },
    select: { id: true, evidence: true, checkResult: true },
    take: 20,
  })
  const out: OrganizerInput[] = []
  for (const r of rows) {
    const c = (r.checkResult && typeof r.checkResult === 'object' && !Array.isArray(r.checkResult) ? r.checkResult : {}) as Record<string, unknown>
    const slug = str(c.slug)?.toLowerCase()
    if (!slug) continue
    const city = str(c.city)
    out.push({
      id: String(r.id),
      slug,
      name: str(c.name) ?? (city ? `Bitcoin Pizza Day ${city}` : `rsv.pizza/${slug}`),
      date: parseDate(c.date),
      city,
      url: `https://rsv.pizza/${slug}`,
    })
  }
  return out
}

export interface EventsAttendedResult {
  events: EventRow[]
  total: number
}

export async function loadEventsAttended(
  memberId: string,
  discordId: string,
  opts: { countTickets: boolean; viewerIsOwner: boolean },
): Promise<EventsAttendedResult> {
  const [stored, tickets, organizer] = await Promise.all([
    prisma.memberRsvEvent.findMany({ where: { memberId }, take: 500 }),
    opts.countTickets ? getTicketSummary(memberId).catch(() => null) : Promise.resolve(null),
    loadOrganizer(memberId, discordId).catch(() => [] as OrganizerInput[]),
  ])
  const attended: AttendedInput[] = stored.map((e) => ({
    id: e.rsvEventId,
    name: e.name,
    date: e.date,
    city: e.city,
    url: e.url,
    guestListHidden: e.guestListHidden,
  }))
  const ticketRows: TicketInput[] = (tickets?.events ?? []).map((t) => ({ id: `${t.networkId}:${t.lockAddress}`, name: t.name, year: t.year, url: t.url }))
  return mergeEvents({ attended, tickets: ticketRows, organizer }, opts)
}

/** A disavowed member's list is never shown (fails closed when the check errors). */
export async function isHiddenSubject(discordId: string): Promise<boolean> {
  if (!(await disavowEnabled().catch(() => false))) return false
  return isDisavowSubject(discordId).catch(() => true)
}
