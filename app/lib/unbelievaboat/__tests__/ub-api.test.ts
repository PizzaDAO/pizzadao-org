// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { createUbClient, UbApiError } from '../ub-api'
import { createMockUb, FIXTURE_GUILD, FIXTURE_TOKEN, fixtureUsers } from './mock-ub'

function client(mock: ReturnType<typeof createMockUb>, extra: Partial<Parameters<typeof createUbClient>[0]> = {}) {
  const sleep = vi.fn(async () => {})
  const c = createUbClient({ token: FIXTURE_TOKEN, fetchImpl: mock.fetchImpl, sleep, minIntervalMs: 0, ...extra })
  return { c, sleep }
}

describe('UnbelievaBoat API client', () => {
  it('pages through the whole leaderboard and sends the bare token', async () => {
    const mock = createMockUb({ pageSize: 3 })
    const { c } = client(mock)
    const { users, pages, duplicates } = await c.getAllUsers(FIXTURE_GUILD, 3)
    expect(pages).toBe(3)
    expect(duplicates).toBe(0)
    expect(users.map((u) => u.user_id).sort()).toEqual(fixtureUsers.map((u) => u.user_id).sort())
    // Authorization is the raw token (no "Bearer"/"Bot" scheme)
    expect(mock.calls.every((call) => call.auth === FIXTURE_TOKEN)).toBe(true)
    const first = new URL(mock.calls[0].url)
    expect(first.pathname).toBe(`/api/v1/guilds/${FIXTURE_GUILD}/users`)
    expect(first.searchParams.get('sort')).toBe('total')
    expect(first.searchParams.get('page')).toBe('1')
  })

  it('waits out a route 429 using retry_after (milliseconds) and retries', async () => {
    const mock = createMockUb({ rateLimitOn: [2] })
    const { c, sleep } = client(mock)
    const { users } = await c.getAllUsers(FIXTURE_GUILD, 2)
    expect(users).toHaveLength(fixtureUsers.length)
    expect(sleep).toHaveBeenCalledWith(2550)
  })

  it('backs off on a global 429 and on 5xx', async () => {
    const mock = createMockUb({ globalLimitOn: [1], serverErrorOn: [3] })
    const { c, sleep } = client(mock)
    const { users } = await c.getAllUsers(FIXTURE_GUILD, 2)
    expect(users).toHaveLength(fixtureUsers.length)
    expect(sleep).toHaveBeenCalledWith(1050) // global: 1s window + margin
    expect(sleep).toHaveBeenCalledWith(500) // first 5xx backoff
  })

  it('gives up after maxAttempts of 429s', async () => {
    const mock = createMockUb({ rateLimitOn: [1, 2, 3] })
    const { c } = client(mock, { maxAttempts: 3 })
    await expect(c.getAllUsers(FIXTURE_GUILD)).rejects.toBeInstanceOf(UbApiError)
  })

  it('pauses when X-RateLimit-Remaining hits 0 until X-RateLimit-Reset', async () => {
    let now = 1_000_000
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ users: [], total_pages: 1 }), {
        status: 200,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(now + 3000) },
      }),
    ) as unknown as typeof fetch
    const sleep = vi.fn(async (ms: number) => {
      now += ms
    })
    const c = createUbClient({ token: 't', fetchImpl, sleep, now: () => now, minIntervalMs: 0 })
    await c.getLeaderboardPage(FIXTURE_GUILD, 1, 10)
    await c.getLeaderboardPage(FIXTURE_GUILD, 2, 10)
    expect(sleep).toHaveBeenCalledWith(3050)
  })

  it('throws a UbApiError with status on 401 (bad token), without retrying', async () => {
    const mock = createMockUb()
    const c = createUbClient({ token: 'wrong', fetchImpl: mock.fetchImpl, sleep: async () => {}, minIntervalMs: 0 })
    await expect(c.getAllUsers(FIXTURE_GUILD)).rejects.toMatchObject({ status: 401 })
    expect(mock.calls).toHaveLength(1)
  })

  it('reads store items, inventories and permissions', async () => {
    const mock = createMockUb({ inventories: { '100000000000000001': [{ item_id: '1', name: 'Rare Pizza Box', quantity: 1 }] } })
    const { c } = client(mock)
    expect((await c.getPermissions(FIXTURE_GUILD)).permissions).toBe(3)
    expect((await c.getStoreItems(FIXTURE_GUILD)).map((i) => i.name)).toContain('Rare Pizza Box')
    expect(await c.getInventory(FIXTURE_GUILD, '100000000000000001')).toHaveLength(1)
    expect(await c.getInventory(FIXTURE_GUILD, '100000000000000003')).toHaveLength(0)
  })

  it('requires a token', () => {
    expect(() => createUbClient({ token: '' })).toThrow(/UNBELIEVABOAT_API_TOKEN/)
  })
})
