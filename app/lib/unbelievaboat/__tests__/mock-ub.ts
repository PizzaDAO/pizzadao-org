/**
 * Mock UnbelievaBoat API built from __fixtures__/leaderboard.json. Usable as
 * a `fetch` replacement (unit tests) or behind a local http server (script
 * tests). Behaves like the real API: token in a bare Authorization header,
 * `page`/`limit` pagination returning { users, total_pages }, X-RateLimit-*
 * headers, and optional injected 429s / 5xx.
 */
import fixture from '../__fixtures__/leaderboard.json'

export const FIXTURE_GUILD = fixture.guildId
export const FIXTURE_TOKEN = 'test-ub-token'
export const fixtureUsers = fixture.users
/** The fixture user the mock's public leaderboard reports as a Discord bot. */
export const BOT_ID = '100000000000000005'

export interface MockOptions {
  pageSize?: number
  /** Return 429 (route limit) on these 1-based request numbers. */
  rateLimitOn?: number[]
  /** Return a global 429 on these request numbers. */
  globalLimitOn?: number[]
  /** Return 502 on these request numbers. */
  serverErrorOn?: number[]
  /** false = the guild's public leaderboard is private (403). */
  publicLeaderboard?: boolean
  /** Live balance overrides for single-user GETs (simulates UB not frozen). */
  changedUsers?: Record<string, { cash: number; bank: number; total: number }>
  inventories?: Record<string, Array<{ item_id: string; name: string; quantity: number }>>
}

export interface MockResponse {
  status: number
  headers: Record<string, string>
  body: string
}

export function createMockUb(opts: MockOptions = {}) {
  const calls: Array<{ url: string; auth: string | null }> = []
  const pageSize = opts.pageSize ?? 2

  const puts: Array<{ userId: string; body: { cash: number; bank: number; reason?: string } }> = []

  function handle(rawUrl: string, auth: string | null, method = 'GET', reqBody = ''): MockResponse {
    calls.push({ url: rawUrl, auth })
    const n = calls.length
    const json = (status: number, body: unknown, headers: Record<string, string> = {}): MockResponse => ({
      status,
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
    const url = new URL(rawUrl)
    const p = url.pathname.replace(/^.*\/api(\/v1)?/, '')

    // Public web-leaderboard JSON (no token). Disabled with publicLeaderboard: false.
    const pub = p.match(/^\/guilds\/(\d+)\/leaderboard$/)
    if (pub) {
      if (opts.publicLeaderboard === false) return json(403, { message: 'Leaderboard is private' })
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 25), pageSize)
      const page = Number(url.searchParams.get('page') ?? 1)
      const balances = fixture.users.slice((page - 1) * limit, page * limit)
      return json(200, {
        balances,
        users: balances.map((b) => ({ id: b.user_id, username: `user${b.user_id.slice(-1)}`, bot: b.user_id === BOT_ID, discriminator: '0' })),
        page,
        total_pages: Math.ceil(fixture.users.length / limit),
      })
    }

    if (auth !== FIXTURE_TOKEN) return json(401, { message: '401: Unauthorized' })
    if (opts.rateLimitOn?.includes(n)) return json(429, { message: 'You are being rate limited', retry_after: 2500 })
    if (opts.globalLimitOn?.includes(n)) return json(429, { message: 'You are being rate limited', global: true })
    if (opts.serverErrorOn?.includes(n)) return { status: 502, headers: {}, body: 'Bad Gateway' }

    const rl = { 'x-ratelimit-limit': '10', 'x-ratelimit-remaining': '9', 'x-ratelimit-reset': String(Date.now() + 1000) }
    if (p === `/applications/@me/guilds/${FIXTURE_GUILD}`) return json(200, { permissions: 3 }, rl)

    const lb = p.match(/^\/guilds\/(\d+)\/users$/)
    if (lb) {
      if (lb[1] !== FIXTURE_GUILD) return json(404, { message: 'Unknown Guild' })
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 1000), pageSize)
      const page = Number(url.searchParams.get('page') ?? 1)
      const totalPages = Math.ceil(fixture.users.length / limit)
      const users = fixture.users.slice((page - 1) * limit, page * limit)
      return json(200, { users, total_pages: totalPages }, rl)
    }

    const one = p.match(/^\/guilds\/(\d+)\/users\/(\d+)$/)
    if (one && method === 'GET') {
      const u = fixture.users.find((x) => x.user_id === one[2])
      const changed = opts.changedUsers?.[one[2]]
      if (!u) return json(404, { message: 'Unknown User' })
      return json(200, changed ? { ...u, ...changed } : u, rl)
    }
    if (one && method === 'PUT') {
      const body = JSON.parse(reqBody || '{}')
      puts.push({ userId: one[2], body })
      return json(200, { user_id: one[2], cash: body.cash, bank: body.bank, total: body.cash + body.bank }, rl)
    }

    const inv = p.match(/^\/guilds\/(\d+)\/users\/(\d+)\/inventory$/)
    if (inv) return json(200, { page: 1, total_pages: 1, items: opts.inventories?.[inv[2]] ?? [] }, rl)

    if (p === `/guilds/${FIXTURE_GUILD}/items`) {
      return json(200, {
        page: 1,
        total_pages: 1,
        items: [
          { id: '1', name: 'Rare Pizza Box', price: 42069, stock_remaining: 3 },
          { id: '2', name: 'Pizza Sticks', price: 1337, stock_remaining: null },
        ],
      }, rl)
    }
    return json(404, { message: 'Not Found' })
  }

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    const r = handle(String(input), headers.get('authorization'), init?.method ?? 'GET', typeof init?.body === 'string' ? init.body : '')
    return new Response(r.body, { status: r.status, headers: r.headers })
  }) as typeof fetch

  return { handle, fetchImpl, calls, puts }
}
