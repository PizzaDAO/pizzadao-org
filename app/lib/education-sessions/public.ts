/**
 * What the public /learn page and the dashboard card may show. Only sessions that are SCHEDULED, not
 * canceled and flagged public ever leave the database, and only the fields below (no creator, no error
 * text, no Discord message ids). The presenter is the name a lead typed for display.
 */
import { prisma } from '@/app/lib/db'
import { SESSION_STATUS } from './build'

export interface PublicSession {
  id: string
  title: string
  presenter: string | null
  description: string
  startsAt: Date
  endsAt: Date
  timeZone: string
  eventUrl: string | null
  recordingUrl: string | null
}

/** The row filter every public read shares. */
export const PUBLIC_WHERE = { status: SESSION_STATUS.SCHEDULED, canceledAt: null, public: true } as const

const SELECT = { id: true, title: true, presenter: true, description: true, startsAt: true, endsAt: true, timeZone: true, eventId: true, recordingUrl: true } as const

type Row = { id: string; title: string; presenter: string | null; description: string; startsAt: Date; endsAt: Date; timeZone: string; eventId: string | null; recordingUrl: string | null }

export function toPublic(r: Row, guildId: string | null): PublicSession {
  const hasEvent = !!r.eventId && r.eventId !== 'PENDING' && !!guildId
  return {
    id: r.id,
    title: r.title,
    presenter: r.presenter,
    description: r.description,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    timeZone: r.timeZone,
    eventUrl: hasEvent ? `https://discord.com/events/${guildId}/${r.eventId}` : null,
    recordingUrl: r.recordingUrl,
  }
}

const guild = () => process.env.DISCORD_GUILD_ID?.trim() || null

/** Upcoming (soonest first) and past (latest first, capped) public sessions. */
export async function listPublicSessions(now: Date = new Date(), pastLimit = 20): Promise<{ upcoming: PublicSession[]; past: PublicSession[] }> {
  const [up, past] = await Promise.all([
    prisma.crewSession.findMany({ where: { ...PUBLIC_WHERE, endsAt: { gte: now } }, orderBy: { startsAt: 'asc' }, take: 50, select: SELECT }),
    prisma.crewSession.findMany({ where: { ...PUBLIC_WHERE, endsAt: { lt: now } }, orderBy: { startsAt: 'desc' }, take: pastLimit, select: SELECT }),
  ])
  const g = guild()
  return { upcoming: up.map((r) => toPublic(r, g)), past: past.map((r) => toPublic(r, g)) }
}

/** One public session by id, or null (canceled, hidden or unknown all look the same). */
export async function getPublicSession(id: string): Promise<PublicSession | null> {
  const r = await prisma.crewSession.findFirst({ where: { id, ...PUBLIC_WHERE }, select: SELECT })
  return r ? toPublic(r, guild()) : null
}

/** The next upcoming public session, for the dashboard card. */
export async function nextPublicSession(now: Date = new Date()): Promise<PublicSession | null> {
  const r = await prisma.crewSession.findFirst({ where: { ...PUBLIC_WHERE, endsAt: { gte: now } }, orderBy: { startsAt: 'asc' }, select: SELECT })
  return r ? toPublic(r, guild()) : null
}
