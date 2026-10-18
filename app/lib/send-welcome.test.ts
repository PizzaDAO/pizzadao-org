import { describe, it, expect, vi } from 'vitest'
import { sendWelcome } from './discord'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

describe('sendWelcome', () => {
  it('DMs, then posts an @mention limited to that user', async () => {
    vi.stubEnv('DISCORD_BOT_TOKEN', 'tok')
    const calls: Array<{ url: string; body: any }> = []
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) })
      return url.endsWith('/users/@me/channels') ? json(200, { id: 'dm1' }) : json(200, {})
    }) as unknown as typeof fetch
    const r = await sendWelcome('u1', 'hi', 'chan1', { fetchImpl })
    expect(r).toEqual({ dm: 'sent', channel: 'sent', transient: false })
    expect(calls[2].url).toContain('/channels/chan1/messages')
    expect(calls[2].body).toEqual({ content: '<@u1> hi', allowed_mentions: { parse: [], users: ['u1'] } })
  })

  it('DM closed (50007) still posts to the channel', async () => {
    vi.stubEnv('DISCORD_BOT_TOKEN', 'tok')
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/users/@me/channels') ? json(200, { id: 'dm1' }) : url.includes('/dm1/') ? json(403, { code: 50007 }) : json(200, {}),
    ) as unknown as typeof fetch
    expect(await sendWelcome('u1', 'hi', 'chan1', { fetchImpl })).toEqual({ dm: 'closed', channel: 'sent', transient: false })
  })

  it('no channel: DM only', async () => {
    vi.stubEnv('DISCORD_BOT_TOKEN', 'tok')
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/users/@me/channels') ? json(200, { id: 'dm1' }) : json(200, {}),
    ) as unknown as typeof fetch
    expect(await sendWelcome('u1', 'hi', null, { fetchImpl })).toEqual({ dm: 'sent', channel: 'skipped', transient: false })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('retries a 429 once after Retry-After (capped), then succeeds', async () => {
    vi.stubEnv('DISCORD_BOT_TOKEN', 'tok')
    let n = 0
    const sleep = vi.fn(async () => {})
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/users/@me/channels') && n++ === 0) return new Response('{}', { status: 429, headers: { 'retry-after': '2' } })
      return url.endsWith('/users/@me/channels') ? json(200, { id: 'dm1' }) : json(200, {})
    }) as unknown as typeof fetch
    expect(await sendWelcome('u1', 'hi', null, { fetchImpl, sleep })).toEqual({ dm: 'sent', channel: 'skipped', transient: false })
    expect(sleep).toHaveBeenCalledWith(2000)
  })

  it('a 429 beyond the cap is not waited on and is transient', async () => {
    vi.stubEnv('DISCORD_BOT_TOKEN', 'tok')
    const sleep = vi.fn(async () => {})
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 429, headers: { 'retry-after': '60' } })) as unknown as typeof fetch
    const r = await sendWelcome('u1', 'hi', null, { fetchImpl, sleep })
    expect(sleep).not.toHaveBeenCalled()
    expect(r).toEqual({ dm: 'failed', channel: 'skipped', transient: true })
  })

  it('DM channel creation failing still lets the channel post go through', async () => {
    vi.stubEnv('DISCORD_BOT_TOKEN', 'tok')
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/users/@me/channels') ? json(500, {}) : json(200, {}),
    ) as unknown as typeof fetch
    expect(await sendWelcome('u1', 'hi', 'chan1', { fetchImpl })).toEqual({ dm: 'failed', channel: 'sent', transient: true })
  })

  it('passes an abort signal to every fetch', async () => {
    vi.stubEnv('DISCORD_BOT_TOKEN', 'tok')
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/users/@me/channels') ? json(200, { id: 'dm1' }) : json(200, {}),
    ) as unknown as typeof fetch
    await sendWelcome('u1', 'hi', 'chan1', { fetchImpl })
    for (const c of (fetchImpl as any).mock.calls) expect(c[1].signal).toBeInstanceOf(AbortSignal)
  })
})
