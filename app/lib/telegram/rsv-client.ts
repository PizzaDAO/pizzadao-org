/**
 * The only module that talks to the rsv.pizza Telegram send proxy (plans/telegram-shared-bot.md).
 * The app never holds the shared bot's token and never calls Telegram for sends: it asks the proxy.
 *
 *   POST {base}/api/service/telegram/dm     send a private message (plain text, optional URL buttons)
 *   POST {base}/api/service/telegram/probe  can the bot DM this user?
 *   GET  {base}/api/service/telegram/city-groups  the city group directory (no chat ids)
 *   POST {base}/api/service/telegram/city-post    post plain text to a city's group
 *
 * Auth is the `x-pizzadao-telegram-key` header (RSV_PIZZA_TELEGRAM_KEY, Production only). Every
 * Telegram outcome comes back as HTTP 200 with a code; 4xx/5xx are our own auth, validation or
 * config problems. The key is never put in an error or log line.
 */

export const RSV_TELEGRAM_TIMEOUT_MS = 10_000
export const DM_TEXT_LIMIT = 3500

type Env = Record<string, string | undefined>

/** Kill switch: TELEGRAM_SENDS_ENABLED set to off/0/false/no blocks every Telegram send. */
export function telegramSendsKilled(env: Env = process.env): boolean {
  return ['off', '0', 'false', 'no'].includes((env.TELEGRAM_SENDS_ENABLED ?? '').trim().toLowerCase())
}

/** Sends need a production deploy, the key, and no kill switch. Previews never reach the proxy. */
export function telegramSendAllowed(env: Env = process.env): boolean {
  return env.VERCEL_ENV === 'production' && !!env.RSV_PIZZA_TELEGRAM_KEY?.trim() && !telegramSendsKilled(env)
}

function baseUrl(env: Env): string {
  return `${(env.RSV_PIZZA_API_URL?.trim() || 'https://api.rsv.pizza').replace(/\/+$/, '')}/api/service/telegram`
}

export type TelegramButton = { text: string; url: string }

/**
 * `not_configured`: key missing or rejected, or the proxy is switched off (nothing sent).
 * `unavailable`: a transient proxy failure that definitely sent nothing; retrying the same key is safe.
 * `uncertain`: the message may have been delivered (timeout, network, 5xx): never auto-retry.
 */
export type DmFailureCode = 'not_started' | 'blocked' | 'rate_limited' | 'bad_request' | 'uncertain' | 'not_configured' | 'unavailable'

export type DmResult = { ok: true; messageId?: number; replay?: boolean } | { ok: false; code: DmFailureCode; retryAfter?: number; replay?: boolean }

export type ProbeResult =
  | { reachable: true }
  | { reachable: false; code: DmFailureCode; retryAfter?: number }

interface CallOpts {
  env?: Env
  fetchImpl?: typeof fetch
}

type Raw = { kind: 'response'; status: number; body: Record<string, unknown> | null } | { kind: 'network' }

async function request(method: 'GET' | 'POST', path: string, payload: unknown, opts: CallOpts): Promise<Raw> {
  const env = opts.env ?? process.env
  const doFetch = opts.fetchImpl ?? fetch
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), RSV_TELEGRAM_TIMEOUT_MS)
  try {
    const res = await doFetch(`${baseUrl(env)}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-pizzadao-telegram-key': env.RSV_PIZZA_TELEGRAM_KEY?.trim() ?? '' },
      ...(method === 'POST' ? { body: JSON.stringify(payload) } : {}),
      cache: 'no-store',
      signal: ctl.signal,
    })
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
    return { kind: 'response', status: res.status, body: body && typeof body === 'object' ? body : null }
  } catch {
    return { kind: 'network' }
  } finally {
    clearTimeout(timer)
  }
}

const post = (path: string, payload: unknown, opts: CallOpts) => request('POST', path, payload, opts)

const DM_CODES = new Set(['not_started', 'blocked', 'rate_limited', 'bad_request', 'uncertain'])

/**
 * Non-200 answers: our own auth, validation or config. 503 carries `reason`: 'unavailable' is a
 * transient proxy failure (nothing sent, key freed); 'not configured' / 'disabled' are config.
 */
function failureFor(status: number, body: Record<string, unknown> | null): DmFailureCode {
  if (status === 401) return 'not_configured'
  if (status === 503) return body?.reason === 'unavailable' ? 'unavailable' : 'not_configured'
  if (status === 400 || status === 409) return 'bad_request'
  if (status === 429) return 'unavailable' // the proxy's own limiter: it rejected before sending
  return 'uncertain'
}

const retryAfterOf = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.ceil(v) : undefined)

export async function sendDm(
  a: { telegramUserId: string; text: string; buttons?: TelegramButton[][]; idempotencyKey: string },
  opts: CallOpts = {},
): Promise<DmResult> {
  if (!telegramSendAllowed(opts.env ?? process.env)) return { ok: false, code: 'not_configured' }
  const raw = await post(
    '/dm',
    { telegramUserId: a.telegramUserId, text: a.text.slice(0, DM_TEXT_LIMIT), ...(a.buttons?.length ? { buttons: a.buttons } : {}), idempotencyKey: a.idempotencyKey },
    opts,
  )
  if (raw.kind === 'network') return { ok: false, code: 'uncertain' }
  const { status, body } = raw
  if (status !== 200) return { ok: false, code: failureFor(status, body) }
  if (body?.ok === true) {
    return { ok: true, ...(typeof body.messageId === 'number' ? { messageId: body.messageId } : {}), ...(body.replay === true ? { replay: true } : {}) }
  }
  if (body?.ok === false && typeof body.code === 'string' && DM_CODES.has(body.code)) {
    const retryAfter = retryAfterOf(body.retryAfter)
    return { ok: false, code: body.code as DmFailureCode, ...(retryAfter !== undefined ? { retryAfter } : {}), ...(body.replay === true ? { replay: true } : {}) }
  }
  return { ok: false, code: 'uncertain' }
}

/** Can the bot DM this user? Sends nothing visible (a typing indicator). */
export async function probe(telegramUserId: string, opts: CallOpts = {}): Promise<ProbeResult> {
  if (!telegramSendAllowed(opts.env ?? process.env)) return { reachable: false, code: 'not_configured' }
  const raw = await post('/probe', { telegramUserId }, opts)
  if (raw.kind === 'network') return { reachable: false, code: 'uncertain' }
  const { status, body } = raw
  if (status !== 200) return { reachable: false, code: failureFor(status, body) }
  if (body?.ok === true && body.reachable === true) return { reachable: true }
  if (body?.ok === true && body.reachable === false && typeof body.code === 'string' && DM_CODES.has(body.code)) {
    const retryAfter = retryAfterOf(body.retryAfter)
    return { reachable: false, code: body.code as DmFailureCode, ...(retryAfter !== undefined ? { retryAfter } : {}) }
  }
  return { reachable: false, code: 'uncertain' }
}

// ---- City group posts (PR P3) ----

export function rsvTelegramConfigured(env: Env = process.env): boolean {
  return !!env.RSV_PIZZA_TELEGRAM_KEY?.trim()
}

export interface CityGroup {
  cityKey: string
  title: string | null
  country: string | null
  region: string | null
  chatUrl: string | null
  hasChat: boolean
}

/** Why the directory could not be read. 'unavailable' is transient. */
export type ProxyReason = 'not_configured' | 'disabled' | 'unavailable' | 'bad_request' | 'uncertain'

export type CityGroupsResult = { ok: true; groups: CityGroup[] } | { ok: false; reason: ProxyReason }

export type CityPostCode = 'no_group' | 'kicked' | 'rate_limited' | 'bad_request' | 'uncertain'
/** Proxy-level failures: nothing was sent (except 'uncertain'). 'disabled': the groups flag is off at rsv.pizza. */
export type CityPostFailure = CityPostCode | 'not_configured' | 'unavailable' | 'disabled'

export type CityPostResult =
  | { ok: true; messageId?: string; migratedTo?: string; replay?: boolean }
  | { ok: false; code: CityPostFailure; retryAfter?: number; replay?: boolean }

const CITY_POST_CODES = new Set<string>(['no_group', 'kicked', 'rate_limited', 'bad_request', 'uncertain'])
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)

/** The city group directory (no chat ids). A read, so it needs only the key. */
export async function cityGroups(opts: CallOpts = {}): Promise<CityGroupsResult> {
  const env = opts.env ?? process.env
  if (!rsvTelegramConfigured(env)) return { ok: false, reason: 'not_configured' }
  const raw = await request('GET', '/city-groups', undefined, opts)
  if (raw.kind === 'network') return { ok: false, reason: 'unavailable' }
  const { status, body } = raw
  if (status === 503 && body?.reason === 'disabled') return { ok: false, reason: 'disabled' }
  if (status !== 200) {
    const f = failureFor(status, body)
    return { ok: false, reason: f === 'uncertain' ? 'unavailable' : f === 'not_configured' || f === 'bad_request' ? f : 'unavailable' }
  }
  if (!body || body.ok !== true || !Array.isArray(body.groups)) return { ok: false, reason: 'unavailable' }
  const groups: CityGroup[] = []
  for (const g of body.groups as Array<Record<string, unknown>>) {
    if (!g || typeof g.cityKey !== 'string') continue
    groups.push({ cityKey: g.cityKey, title: str(g.title), country: str(g.country), region: str(g.region), chatUrl: str(g.chatUrl), hasChat: g.hasChat === true })
  }
  return { ok: true, groups }
}

/**
 * Post plain text to a city's group. The same idempotencyKey always yields the same outcome (the
 * proxy replays it), except that a stored rate_limited may be retried with the same key. No
 * network call unless telegramSendAllowed(). A timeout, network error or proxy 5xx is `uncertain`.
 */
export async function cityPost(a: { cityKey: string; text: string; idempotencyKey: string }, opts: CallOpts = {}): Promise<CityPostResult> {
  if (!telegramSendAllowed(opts.env ?? process.env)) return { ok: false, code: 'not_configured' }
  const raw = await post('/city-post', { cityKey: a.cityKey, text: a.text.slice(0, DM_TEXT_LIMIT), idempotencyKey: a.idempotencyKey }, opts)
  if (raw.kind === 'network') return { ok: false, code: 'uncertain' }
  const { status, body } = raw
  if (status === 503 && body?.reason === 'disabled') return { ok: false, code: 'disabled' }
  // failureFor only yields not_configured / unavailable / bad_request / uncertain here.
  if (status !== 200) return { ok: false, code: failureFor(status, body) as CityPostFailure }
  if (body?.ok === true) {
    return {
      ok: true,
      ...(body.messageId !== undefined && body.messageId !== null ? { messageId: String(body.messageId) } : {}),
      ...(typeof body.migratedTo === 'string' ? { migratedTo: body.migratedTo } : {}),
      ...(body.replay === true ? { replay: true } : {}),
    }
  }
  if (body?.ok === false && typeof body.code === 'string' && CITY_POST_CODES.has(body.code)) {
    const retryAfter = retryAfterOf(body.retryAfter)
    return { ok: false, code: body.code as CityPostCode, ...(retryAfter !== undefined ? { retryAfter } : {}), ...(body.replay === true ? { replay: true } : {}) }
  }
  return { ok: false, code: 'uncertain' }
}
