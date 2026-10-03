/**
 * Minimal, read-only client for the official UnbelievaBoat API (v1).
 *
 * Docs: https://api-docs.unbelievaboat.com/reference/reference
 *   Base URL     https://unbelievaboat.com/api/v1
 *   Auth         `Authorization: <token>` (no "Bearer"/"Bot" scheme). Tokens are
 *                created per Discord application at
 *                https://unbelievaboat.com/applications and only work in
 *                guilds where that application has been authorized.
 *   Leaderboard  GET /guilds/{guild_id}/users?sort=total&limit=&page=
 *                -> with `page`: { users: [{rank,user_id,cash,bank,total}], total_pages }
 *   Inventory    GET /guilds/{guild_id}/users/{user_id}/inventory?page=&limit=
 *                -> { page, total_pages, items: [{item_id,name,quantity,...}] }
 *   Store        GET /guilds/{guild_id}/items?page=&limit=
 *   Rate limits  headers X-RateLimit-Limit / -Remaining / -Reset (unix ms);
 *                429 body { message, retry_after (ms) } or { message, global: true };
 *                global cap 20 req/s per token.
 *
 * Only GET endpoints are used, except setBalance(), which the separate
 * zero-balances script calls once at cutover (dry-run by default).
 */

export const UB_API_BASE = 'https://unbelievaboat.com/api/v1'

export interface UbUserBalance {
  rank: string | number | null
  user_id: string
  /** Normally an integer; UB has historically serialized unlimited balances as "Infinity". */
  cash: number | string
  bank: number | string
  total: number | string
}

export interface UbInventoryItem {
  item_id: string
  name: string
  quantity: number
  [key: string]: unknown
}

export interface UbStoreItem {
  id: string
  name: string
  price?: number | string
  stock_remaining?: number | null
  [key: string]: unknown
}

export interface UbClientOptions {
  token: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  baseUrl?: string
  /** Max attempts per request (429s and 5xx are retried). Default 8. */
  maxAttempts?: number
  /** Minimum spacing between requests in ms. Default 60 (≈16 req/s, under the 20/s global cap). */
  minIntervalMs?: number
  log?: (msg: string) => void
}

export class UbApiError extends Error {
  status: number
  body: string
  constructor(status: number, body: string, path: string) {
    super(`UnbelievaBoat API ${status} on ${path}: ${body.slice(0, 300)}`)
    this.name = 'UbApiError'
    this.status = status
    this.body = body
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function makeRequester(opts: UbClientOptions & { auth: boolean }) {
  const fetchImpl = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? defaultSleep
  const now = opts.now ?? Date.now
  const base = (opts.baseUrl ?? UB_API_BASE).replace(/\/$/, '')
  const maxAttempts = opts.maxAttempts ?? 8
  const minInterval = opts.minIntervalMs ?? 60
  const log = opts.log ?? (() => {})

  let lastRequestAt = 0
  // Proactive bucket tracking from X-RateLimit-* headers.
  let remaining: number | null = null
  let resetAt = 0
  let requestCount = 0

  async function request<T>(
    path: string,
    query: Record<string, string | number | undefined> = {},
    write?: { method: 'PUT' | 'PATCH'; body: unknown },
  ): Promise<T> {
    const url = new URL(base + path)
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v))

    for (let attempt = 1; ; attempt++) {
      // Respect our own spacing and an exhausted bucket before sending.
      const t = now()
      if (remaining !== null && remaining <= 0 && resetAt > t) {
        const wait = resetAt - t + 50
        log(`rate limit bucket empty, waiting ${wait}ms`)
        await sleep(wait)
      }
      const gap = lastRequestAt + minInterval - now()
      if (gap > 0) await sleep(gap)
      lastRequestAt = now()
      requestCount++

      let res: Response
      try {
        res = await fetchImpl(url.toString(), {
          method: write?.method ?? 'GET',
          headers: {
            Accept: 'application/json',
            ...(opts.auth ? { Authorization: opts.token } : {}),
            ...(write ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(write ? { body: JSON.stringify(write.body) } : {}),
        })
      } catch (err) {
        if (attempt >= maxAttempts) throw err
        const backoff = Math.min(30_000, 500 * 2 ** (attempt - 1))
        log(`network error (${(err as Error).message}); retry ${attempt}/${maxAttempts} in ${backoff}ms`)
        await sleep(backoff)
        continue
      }

      const rem = res.headers.get('x-ratelimit-remaining')
      const reset = res.headers.get('x-ratelimit-reset')
      if (rem !== null && rem !== '') remaining = Number(rem)
      if (reset !== null && reset !== '') resetAt = Number(reset)

      if (res.status === 429) {
        const text = await res.text()
        let retryAfter = 1000
        try {
          const body = JSON.parse(text) as { retry_after?: number; global?: boolean }
          if (typeof body.retry_after === 'number') retryAfter = body.retry_after
          else if (body.global) retryAfter = 1000 // global 20 req/s window
        } catch {
          const header = Number(res.headers.get('retry-after'))
          if (Number.isFinite(header) && header > 0) retryAfter = header
        }
        if (attempt >= maxAttempts) throw new UbApiError(429, text, path)
        log(`429 on ${path}; waiting ${retryAfter}ms (attempt ${attempt}/${maxAttempts})`)
        await sleep(retryAfter + 50)
        continue
      }

      if (res.status >= 500) {
        const text = await res.text()
        if (attempt >= maxAttempts) throw new UbApiError(res.status, text, path)
        const backoff = Math.min(30_000, 500 * 2 ** (attempt - 1))
        log(`${res.status} on ${path}; retry ${attempt}/${maxAttempts} in ${backoff}ms`)
        await sleep(backoff)
        continue
      }

      if (!res.ok) throw new UbApiError(res.status, await res.text(), path)
      return (await res.json()) as T
    }
  }

  return {
    request,
    get requestCount() {
      return requestCount
    },
  }
}

export function createUbClient(opts: UbClientOptions) {
  if (!opts.token) throw new Error('UNBELIEVABOAT_API_TOKEN is required')
  const requester = makeRequester({ ...opts, auth: true })
  const request = requester.request
  const log = opts.log ?? (() => {})

  /** One leaderboard page. `page` is 1-based. */
  async function getLeaderboardPage(guildId: string, page: number, limit: number) {
    const body = await request<{ users?: UbUserBalance[]; total_pages?: number } | UbUserBalance[]>(
      `/guilds/${encodeURIComponent(guildId)}/users`,
      { sort: 'total', limit, page },
    )
    // With `page` the API returns { users, total_pages }; tolerate the bare-array form too.
    if (Array.isArray(body)) return { users: body, totalPages: page }
    return { users: body.users ?? [], totalPages: Number(body.total_pages ?? page) }
  }

  /**
   * Every user on the guild leaderboard, all pages. De-duplicates by user_id
   * (ranks can shift between pages if balances change mid-export, which is
   * why the export should run only after UB earning is frozen).
   */
  async function getAllUsers(guildId: string, pageSize = 1000) {
    const byId = new Map<string, UbUserBalance>()
    let duplicates = 0
    let page = 1
    let totalPages = 1
    do {
      const res = await getLeaderboardPage(guildId, page, pageSize)
      totalPages = res.totalPages
      for (const u of res.users) {
        if (byId.has(u.user_id)) duplicates++
        byId.set(u.user_id, u)
      }
      log(`leaderboard page ${page}/${totalPages}: ${res.users.length} users`)
      if (res.users.length === 0) break
      page++
    } while (page <= totalPages)
    return { users: [...byId.values()], pages: totalPages, duplicates }
  }

  async function getGuild(guildId: string) {
    return request<Record<string, unknown>>(`/guilds/${encodeURIComponent(guildId)}`)
  }

  /** Bitfield: 1 = ECONOMY (balances), 2 = ITEMS (store + inventories), per UB's dashboard bundle. */
  async function getPermissions(guildId: string) {
    return request<{ permissions: number }>(`/applications/@me/guilds/${encodeURIComponent(guildId)}`)
  }

  async function getStoreItems(guildId: string) {
    const items: UbStoreItem[] = []
    let page = 1
    let totalPages = 1
    do {
      const res = await request<{ items?: UbStoreItem[]; total_pages?: number }>(
        `/guilds/${encodeURIComponent(guildId)}/items`,
        { page, limit: 100 },
      )
      items.push(...(res.items ?? []))
      totalPages = Number(res.total_pages ?? 1)
      page++
    } while (page <= totalPages)
    return items
  }

  async function getInventory(guildId: string, userId: string) {
    const items: UbInventoryItem[] = []
    let page = 1
    let totalPages = 1
    do {
      const res = await request<{ items?: UbInventoryItem[]; total_pages?: number }>(
        `/guilds/${encodeURIComponent(guildId)}/users/${encodeURIComponent(userId)}/inventory`,
        { page, limit: 100 },
      )
      items.push(...(res.items ?? []))
      totalPages = Number(res.total_pages ?? 1)
      page++
    } while (page <= totalPages)
    return items
  }

  /**
   * Cutover only (scripts/unbelievaboat/zero-balances.mjs): set a user's UB
   * cash and bank, recorded in UB's audit log with `reason`.
   * PUT /guilds/{guild_id}/users/{user_id}  { cash, bank, reason }
   */
  async function setBalance(guildId: string, userId: string, body: { cash: number; bank: number; reason: string }) {
    return request<UbUserBalance>(
      `/guilds/${encodeURIComponent(guildId)}/users/${encodeURIComponent(userId)}`,
      {},
      { method: 'PUT', body },
    )
  }

  return {
    request,
    setBalance,
    getLeaderboardPage,
    getAllUsers,
    getGuild,
    getPermissions,
    getStoreItems,
    getInventory,
    get requestCount() {
      return requester.requestCount
    },
  }
}

export type UbClient = ReturnType<typeof createUbClient>

/**
 * Token-less fallback: the JSON behind the public web leaderboard
 * (https://unbelievaboat.com/leaderboard/{guild_id}). Undocumented and
 * unofficial, so it may change without notice; it only works while the
 * guild's leaderboard is public; pages are capped at 25 users. It also returns
 * Discord user objects (username, bot flag), which the API path needs
 * --resolve-discord for. It cannot read inventories or store items, and
 * without a token balances cannot be zeroed in UB at cutover.
 *
 *   GET https://unbelievaboat.com/api/guilds/{guild_id}/leaderboard?limit=25&page=N
 *   -> { balances: [{rank,user_id,cash,bank,total}], users: [{id,username,bot,...}], page, total_pages }
 */
export const UB_PUBLIC_BASE = 'https://unbelievaboat.com/api'

export function createPublicUbClient(opts: Omit<UbClientOptions, 'token'> = {}) {
  const requester = makeRequester({ ...opts, token: '', baseUrl: opts.baseUrl ?? UB_PUBLIC_BASE, auth: false, minIntervalMs: opts.minIntervalMs ?? 250 })
  const log = opts.log ?? (() => {})

  async function getAllUsers(guildId: string) {
    const byId = new Map<string, UbUserBalance>()
    const discord = new Map<string, { username: string | null; bot: boolean | null; inGuild: boolean | null }>()
    let duplicates = 0
    let page = 1
    let totalPages = 1
    do {
      const res = await requester.request<{
        balances?: UbUserBalance[]
        users?: Array<{ id: string; username?: string; bot?: boolean }>
        total_pages?: number
      }>(`/guilds/${encodeURIComponent(guildId)}/leaderboard`, { limit: 25, page })
      totalPages = Number(res.total_pages ?? page)
      const balances = res.balances ?? []
      for (const b of balances) {
        if (byId.has(b.user_id)) duplicates++
        byId.set(b.user_id, b)
      }
      for (const u of res.users ?? []) discord.set(String(u.id), { username: u.username ?? null, bot: !!u.bot, inGuild: null })
      log(`public leaderboard page ${page}/${totalPages}: ${balances.length} users`)
      if (balances.length === 0) break
      page++
    } while (page <= totalPages)
    return { users: [...byId.values()], pages: totalPages, duplicates, discord }
  }

  return {
    getAllUsers,
    get requestCount() {
      return requester.requestCount
    },
  }
}
