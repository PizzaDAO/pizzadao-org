/**
 * Pure helpers for scheduling an education session: validate the form, work out the UTC times, and
 * build the Discord event payload and the announcement text. No I/O here (tests need none).
 */
import { createHash } from 'crypto'
import { isValidTimeZone, zonedWallTimeToUtc } from '@/app/lib/calls/zoned-time'

export const EDUCATION_CREW_ID = 'education'
export const MAX_TITLE = 100 // Discord event name limit
export const MAX_DESCRIPTION = 1000 // Discord event description limit
export const MAX_PRESENTER = 100
export const MIN_LENGTH_MIN = 15
export const MAX_LENGTH_MIN = 8 * 60

export interface SessionTimes {
  title: string
  presenter: string | null
  description: string
  timeZone: string
  startsAt: Date
  endsAt: Date
}

export class SessionInputError extends Error {}

const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/[ \t]+\n/g, '\n').trim() : '')

/**
 * Validate the raw form body (title, presenter, description, date YYYY-MM-DD and time HH:MM as wall
 * clock in timeZone, lengthMinutes). Throws SessionInputError with a message fit to show the lead.
 */
export function parseSessionInput(raw: unknown, now: Date = new Date()): SessionTimes {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const title = clean(b.title)
  const presenter = clean(b.presenter)
  const description = clean(b.description)
  const timeZone = clean(b.timeZone)
  if (!title) throw new SessionInputError('Add a title.')
  if (title.length > MAX_TITLE) throw new SessionInputError(`The title is over ${MAX_TITLE} characters.`)
  if (presenter.length > MAX_PRESENTER) throw new SessionInputError(`The presenter is over ${MAX_PRESENTER} characters.`)
  if (!description) throw new SessionInputError('Add a description.')
  if (description.length > MAX_DESCRIPTION) throw new SessionInputError(`The description is over ${MAX_DESCRIPTION} characters.`)
  if (!timeZone || !isValidTimeZone(timeZone)) throw new SessionInputError('Pick a valid time zone.')
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(b.date))
  const t = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(clean(b.time))
  if (!d || !t) throw new SessionInputError('Pick a date and a time.')
  const len = Number(b.lengthMinutes)
  if (!Number.isInteger(len) || len < MIN_LENGTH_MIN || len > MAX_LENGTH_MIN) {
    throw new SessionInputError(`The length must be ${MIN_LENGTH_MIN} to ${MAX_LENGTH_MIN} minutes.`)
  }
  const startMs = zonedWallTimeToUtc(Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2]), timeZone)
  if (!Number.isFinite(startMs)) throw new SessionInputError('Pick a valid date.')
  if (startMs <= now.getTime() + 60_000) throw new SessionInputError('The session must start in the future.')
  return {
    title,
    presenter: presenter || null,
    description,
    timeZone,
    startsAt: new Date(startMs),
    endsAt: new Date(startMs + len * 60_000),
  }
}

/** Stable per (crew, title, start): submitting the same session twice is one session. */
export function dedupeKey(crewId: string, s: Pick<SessionTimes, 'title' | 'startsAt'>): string {
  return createHash('sha256').update(`${crewId}\n${s.title.trim().toLowerCase()}\n${s.startsAt.toISOString()}`).digest('hex').slice(0, 32)
}

/** Discord channel type 13 is a stage (event entity type 1); voice (2) is entity type 2. */
export function buildEventPayload(
  s: SessionTimes,
  channel: { id: string; type: number },
  imageDataUri?: string,
): Record<string, unknown> {
  const description = [s.presenter ? `Presented by ${s.presenter}` : '', s.description].filter(Boolean).join('\n\n').slice(0, MAX_DESCRIPTION)
  return {
    name: s.title.slice(0, MAX_TITLE),
    privacy_level: 2, // GUILD_ONLY
    entity_type: channel.type === 13 ? 1 : 2,
    channel_id: channel.id,
    scheduled_start_time: s.startsAt.toISOString(),
    scheduled_end_time: s.endsAt.toISOString(),
    description,
    ...(imageDataUri ? { image: imageDataUri } : {}),
  }
}

/** The long, human date for the flyer, in the session's own zone. */
export function formatWhen(s: Pick<SessionTimes, 'startsAt' | 'timeZone'>): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: s.timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(s.startsAt)
}

/** The announcement. Discord renders <t:unix:F> in each reader's own zone. */
export function buildAnnouncement(s: SessionTimes, eventUrl: string | null): string {
  const unix = Math.floor(s.startsAt.getTime() / 1000)
  return [
    `🎓 **${s.title}**`,
    s.presenter ? `Presented by ${s.presenter}` : null,
    '',
    s.description,
    '',
    `🕒 <t:${unix}:F> (<t:${unix}:R>)`,
    eventUrl ? `📅 Set a reminder: ${eventUrl}` : null,
  ]
    .filter((l): l is string => l !== null)
    .join('\n')
    .slice(0, 2000)
}

/** Message body setting: never pings anyone. */
export const NO_MENTIONS = { parse: [] as Array<'everyone' | 'roles' | 'users'> }
