/**
 * Typed client for rsv.pizza `POST {base}/api/service/upcoming-events`: the curated, public, future events
 * (GPP and approved series). The only module that knows the wire contract.
 *
 *   request:  { until: ISO date (latest start wanted), limit: <= 500 }
 *   response: { ok: true, events: [{ eventId, url, name, date, timezone, city, latitude, longitude,
 *               addressIsCityDefault, full, rsvpClosed, kind: 'gpp' | 'series' }] }
 *             soonest first. No host, guest or street-address data.
 *   errors:   503 { reason: 'disabled' } (flag off), 401 bad key.
 *
 * Auth is the shared rsv.pizza service key (RSV_PIZZA_SERVICE_KEY, `x-service-key`), like guest-attendance.
 * Any failure (no key, timeout, non-200, bad body) is null: "no data this run". The key is never logged.
 */
import { z } from 'zod'

export const UPCOMING_EVENTS_TIMEOUT_MS = 6_000
export const UPCOMING_EVENTS_LIMIT = 500

export interface NearbyEvent {
  id: string
  url: string
  name: string
  startsAt: Date
  timezone: string | null
  city: string | null
  lat: number
  lng: number
  /** The coordinates are a city centre, not the venue. */
  cityLevel: boolean
  full: boolean
  rsvpClosed: boolean
  kind: 'gpp' | 'series'
}

const eventSchema = z
  .object({
    eventId: z.string().min(1).max(100),
    url: z.string().max(300),
    name: z.string().min(1).max(200),
    date: z.string().max(40),
    timezone: z.string().max(64).nullable().optional(),
    city: z.string().max(120).nullable().optional(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    addressIsCityDefault: z.boolean().optional(),
    full: z.boolean().optional(),
    rsvpClosed: z.boolean().optional(),
    kind: z.enum(['gpp', 'series']),
  })
  // Unknown fields (anything about hosts or guests) reject the whole answer: the contract is data-minimal.
  .strict()

const body = z.object({ ok: z.literal(true), events: z.array(eventSchema).max(UPCOMING_EVENTS_LIMIT) })

export interface UpcomingEventsOpts {
  baseUrl: string
  until: Date
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

/** The upcoming curated events, or null when the lookup failed. */
export async function fetchUpcomingEvents(opts: UpcomingEventsOpts): Promise<NearbyEvent[] | null> {
  const serviceKey = (opts.env ?? process.env).RSV_PIZZA_SERVICE_KEY?.trim()
  const baseUrl = opts.baseUrl.trim().replace(/\/+$/, '')
  if (!serviceKey || !/^https:\/\//i.test(baseUrl)) return null
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? UPCOMING_EVENTS_TIMEOUT_MS)
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${baseUrl}/api/service/upcoming-events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-service-key': serviceKey },
      body: JSON.stringify({ until: opts.until.toISOString(), limit: UPCOMING_EVENTS_LIMIT }),
      signal: ctl.signal,
      cache: 'no-store',
      // The shared secret must never follow a redirect to another host.
      redirect: 'error',
    })
    if (res.status !== 200) return null
    const parsed = body.safeParse(await res.json())
    if (!parsed.success) return null
    const out: NearbyEvent[] = []
    for (const e of parsed.data.events) {
      const startsAt = new Date(e.date)
      // Only https links are ever sent to members.
      if (Number.isNaN(startsAt.getTime()) || !/^https:\/\//i.test(e.url)) continue
      out.push({
        id: e.eventId,
        url: e.url,
        name: e.name,
        startsAt,
        timezone: e.timezone ?? null,
        city: e.city ?? null,
        lat: e.latitude,
        lng: e.longitude,
        cityLevel: e.addressIsCityDefault === true,
        full: e.full === true,
        rsvpClosed: e.rsvpClosed === true,
        kind: e.kind,
      })
    }
    return out
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
