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
    expect(r).toEqual({ dm: 'sent', channel: 'sent' })
    expect(calls[2].url).toContain('/channels/chan1/messages')
    expect(calls[2].body).toEqual({ content: '<@u1> hi', allowed_mentions: { parse: [], users: ['u1'] } })
  })

  it('DM closed (50007) still posts to the channel', async () => {
    vi.stubEnv('DISCORD_BOT_TOKEN', 'tok')
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/users/@me/channels') ? json(200, { id: 'dm1' }) : url.includes('/dm1/') ? json(403, { code: 50007 }) : json(200, {}),
    ) as unknown as typeof fetch
    expect(await sendWelcome('u1', 'hi', 'chan1', { fetchImpl })).toEqual({ dm: 'closed', channel: 'sent' })
  })

  it('no channel: DM only', async () => {
    vi.stubEnv('DISCORD_BOT_TOKEN', 'tok')
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/users/@me/channels') ? json(200, { id: 'dm1' }) : json(200, {}),
    ) as unknown as typeof fetch
    expect(await sendWelcome('u1', 'hi', null, { fetchImpl })).toEqual({ dm: 'sent', channel: 'skipped' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
