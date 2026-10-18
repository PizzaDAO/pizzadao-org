import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const page = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({ roles: [], user: { id: String(from + i) } }))
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('listAllGuildMembers / writeGuildMember (anchovy-52918)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('DISCORD_GUILD_ID', 'g1')
    vi.stubEnv('DISCORD_BOT_TOKEN', 'tok')
  })
  afterEach(() => vi.unstubAllEnvs())

  it('pages with after= until a short page', async () => {
    const d = await import('./discord')
    const urls: string[] = []
    const fetchImpl = vi.fn(async (u: string | URL | Request) => {
      urls.push(String(u))
      return urls.length === 1 ? json(page(1, 1000)) : json(page(1001, 3))
    }) as unknown as typeof fetch
    const all = await d.listAllGuildMembers({ fetchImpl })
    expect(all).toHaveLength(1003)
    expect(urls[0]).toContain('limit=1000&after=0')
    expect(urls[1]).toContain('after=1000')
  })

  it('throws on a non-OK response instead of returning a partial list', async () => {
    const d = await import('./discord')
    const fetchImpl = vi.fn(async () => json({ message: 'Missing Access' }, 403)) as unknown as typeof fetch
    await expect(d.listAllGuildMembers({ fetchImpl })).rejects.toThrow('403')
  })

  it('waits out one short 429 then continues', async () => {
    const d = await import('./discord')
    const sleep = vi.fn(async () => {})
    let n = 0
    const fetchImpl = vi.fn(async () => (n++ === 0 ? json({ retry_after: 1.5 }, 429) : json(page(1, 2)))) as unknown as typeof fetch
    expect(await d.listAllGuildMembers({ fetchImpl, sleep })).toHaveLength(2)
    expect(sleep).toHaveBeenCalledWith(1500)
  })

  it('writes a nick with only { nick } and an audit reason; roles go through PUT / DELETE', async () => {
    const d = await import('./discord')
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(null, { status: 204, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '1.2' } })
    }) as unknown as typeof fetch
    const r = await d.writeGuildMember({ kind: 'nick', userId: 'u1', nick: 'Pizza Trainee' }, 'why now', { fetchImpl })
    await d.writeGuildMember({ kind: 'addRole', userId: 'u1', roleId: '555555' }, 'x', { fetchImpl })
    await d.writeGuildMember({ kind: 'removeRole', userId: 'u1', roleId: '555555' }, 'x', { fetchImpl })
    expect(calls[0].url).toBe('https://discord.com/api/v10/guilds/g1/members/u1')
    expect(calls[0].init.method).toBe('PATCH')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ nick: 'Pizza Trainee' })
    expect((calls[0].init.headers as Record<string, string>)['X-Audit-Log-Reason']).toBe('why%20now')
    expect(calls[1]).toMatchObject({ url: 'https://discord.com/api/v10/guilds/g1/members/u1/roles/555555', init: { method: 'PUT' } })
    expect(calls[2].init.method).toBe('DELETE')
    expect(r).toMatchObject({ status: 204, remaining: 0, resetAfterMs: 1200 })
  })

  it('reports a 429 wait and flags a global block', async () => {
    const d = await import('./discord')
    const fetchImpl = vi.fn(async () => json({ retry_after: 2, global: true }, 429)) as unknown as typeof fetch
    expect(await d.writeGuildMember({ kind: 'nick', userId: 'u', nick: null }, 'x', { fetchImpl })).toMatchObject({
      status: 429,
      retryAfterMs: 2000,
      blocked: true,
    })
  })
})
