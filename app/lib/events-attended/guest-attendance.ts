/**
 * Typed client for rsv.pizza `POST {base}/api/service/guest-attendance`. The only module that knows
 * the wire contract, so a change on the other side is a change here.
 *
 *   request:  { emailHashes?: string[<=10] (sha256 hex of lower(trim(email))), wallets?: string[<=10] (0x EVM),
 *               dryRun?: boolean }   at least one identifier; a dry run takes emailHashes only (<=100)
 *   response: { ok: true, events: [{ eventId, name, date, city, url, matchedBy: ('email'|'wallet')[],
 *               hideGuestList }] }   newest first, at most 100, check-ins only
 *             or, for a dry run, { ok: true, dryRun: true, matchedMembers: n }
 *   errors:   503 { reason: 'disabled' } (flag off), 401 bad key, 400 { reason }
 *
 * Auth is the shared rsv.pizza service key (RSV_PIZZA_SERVICE_KEY, `x-service-key`), same as the host
 * lookup. The base URL comes from the caller (a DB setting; see config.ts). Any failure (no key, timeout,
 * non-200, bad body) is null, which callers treat as "no data, keep what we have". The key is never logged.
 */
import { z } from 'zod'

export const GUEST_ATTENDANCE_TIMEOUT_MS = 4_000
export const GUEST_ATTENDANCE_MAX_HASHES = 10
export const GUEST_ATTENDANCE_MAX_WALLETS = 10
export const GUEST_ATTENDANCE_DRY_RUN_MAX_HASHES = 100

export interface GuestAttendanceRequest {
  emailHashes?: string[]
  wallets?: string[]
}

export interface GuestAttendanceEvent {
  id: string
  name: string
  date: string | null
  city: string | null
  url: string | null
  matchedBy: 'email' | 'wallet'
  guestListHidden: boolean
}

const eventSchema = z.object({
  eventId: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  date: z.string().max(40).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  url: z.string().max(300).nullable().optional(),
  matchedBy: z.array(z.enum(['email', 'wallet'])).max(2),
  hideGuestList: z.boolean().optional(),
})

const eventsBody = z.object({ ok: z.literal(true), events: z.array(eventSchema).max(100) })
const dryRunBody = z.object({ ok: z.literal(true), dryRun: z.literal(true), matchedMembers: z.number().int().min(0).max(1_000_000) })

const HASH_RE = /^[0-9a-f]{64}$/
const WALLET_RE = /^0x[0-9a-fA-F]{40}$/

export interface GuestAttendanceOpts {
  /** rsv.pizza API base URL (https). */
  baseUrl: string
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

async function call(body: Record<string, unknown>, opts: GuestAttendanceOpts): Promise<unknown | null> {
  const serviceKey = (opts.env ?? process.env).RSV_PIZZA_SERVICE_KEY?.trim()
  const baseUrl = opts.baseUrl.trim().replace(/\/+$/, '')
  if (!serviceKey || !/^https:\/\//i.test(baseUrl)) return null
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? GUEST_ATTENDANCE_TIMEOUT_MS)
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${baseUrl}/api/service/guest-attendance`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-service-key': serviceKey },
      body: JSON.stringify(body),
      signal: ctl.signal,
      cache: 'no-store',
      // The shared secret must never follow a redirect to another host.
      redirect: 'error',
    })
    if (res.status !== 200) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Checked-in parties for these identifiers, or null when the lookup failed. */
export async function fetchGuestAttendance(req: GuestAttendanceRequest, opts: GuestAttendanceOpts): Promise<GuestAttendanceEvent[] | null> {
  const emailHashes = [...new Set((req.emailHashes ?? []).filter((h) => HASH_RE.test(h)))].slice(0, GUEST_ATTENDANCE_MAX_HASHES)
  const wallets = [...new Set((req.wallets ?? []).filter((w) => WALLET_RE.test(w)))].slice(0, GUEST_ATTENDANCE_MAX_WALLETS)
  if (!emailHashes.length && !wallets.length) return null
  const parsed = eventsBody.safeParse(await call({ ...(emailHashes.length ? { emailHashes } : {}), ...(wallets.length ? { wallets } : {}) }, opts))
  if (!parsed.success) return null
  return parsed.data.events.map((e) => ({
    id: e.eventId,
    name: e.name,
    date: e.date ?? null,
    city: e.city ?? null,
    url: e.url ?? null,
    // The wire has both when both matched; an email match is the stronger claim.
    matchedBy: e.matchedBy.includes('email') ? 'email' : 'wallet',
    guestListHidden: e.hideGuestList === true,
  }))
}

/** How many members these hashes match (admin coverage check; emailHashes only); null when the lookup failed. */
export async function countGuestAttendance(emailHashes: string[], opts: GuestAttendanceOpts): Promise<number | null> {
  const hashes = [...new Set(emailHashes.filter((h) => HASH_RE.test(h)))].slice(0, GUEST_ATTENDANCE_DRY_RUN_MAX_HASHES)
  if (!hashes.length) return null
  const parsed = dryRunBody.safeParse(await call({ emailHashes: hashes, dryRun: true }, opts))
  return parsed.success ? parsed.data.matchedMembers : null
}
