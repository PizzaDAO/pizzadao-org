import { describe, expect, it, vi } from 'vitest'
import { FORWARD_RETRY_DELAYS_MS, MAX_FORWARD_CHARS, MAX_QUEUED_PER_CHANNEL, postTriviaAnswer, TriviaForwarder, type ForwardBody, type ForwardResult, type TriviaForwardConfig, type TriviaMessage } from './trivia-forward.js'
import { parseRemoteConfig, REMOTE_CONFIG_OFF } from './remote-config.js'

const GUILD = '800000000000000001'
const CHAN = '800000000000000002'
const ON: TriviaForwardConfig = { enabled: true, channelIds: [CHAN] }

function msg(over: Partial<TriviaMessage> = {}): TriviaMessage {
  return { id: '900000000000000001', content: 'true', channelId: CHAN, guildId: GUILD, author: { id: '111111111111111111', bot: false }, ...over }
}

function setup(config: TriviaForwardConfig = ON, results: ForwardResult[] = []) {
  const bodies: ForwardBody[] = []
  const post = vi.fn(async (b: ForwardBody) => {
    bodies.push(b)
    return results.shift() ?? ('ok' as ForwardResult)
  })
  const sleep = vi.fn(async () => {})
  const log = vi.fn()
  const f = new TriviaForwarder({ config: () => config, post, sleep, log, guildId: GUILD })
  return { f, post, sleep, log, bodies }
}

describe('TriviaForwarder filters', () => {
  it('forwards a short human message in the trivia channel', async () => {
    const { f, bodies } = setup()
    f.onMessage(msg({ content: '  Trie  ' }))
    await f.idle()
    expect(bodies).toEqual([{ channelId: CHAN, messageId: '900000000000000001', authorId: '111111111111111111', content: 'Trie' }])
  })

  it('drops other channels, other guilds, bots, webhooks, system messages, empty and long text', async () => {
    const { f, post } = setup()
    f.onMessage(msg({ channelId: '800000000000000099' }))
    f.onMessage(msg({ guildId: '5' }))
    f.onMessage(msg({ guildId: null }))
    f.onMessage(msg({ author: { id: '1', bot: true } }))
    f.onMessage(msg({ webhookId: '77' }))
    f.onMessage(msg({ system: true }))
    f.onMessage(msg({ content: '   ' }))
    f.onMessage(msg({ content: 'x'.repeat(MAX_FORWARD_CHARS + 1) }))
    await f.idle()
    expect(post).not.toHaveBeenCalled()
  })

  it('keeps a message of exactly the limit', async () => {
    const { f, post } = setup()
    f.onMessage(msg({ content: 'x'.repeat(MAX_FORWARD_CHARS) }))
    await f.idle()
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('config off (or no channels) forwards nothing', async () => {
    for (const cfg of [{ enabled: false, channelIds: [CHAN] }, { enabled: true, channelIds: [] }]) {
      const { f, post } = setup(cfg)
      f.onMessage(msg())
      await f.idle()
      expect(post).not.toHaveBeenCalled()
    }
  })

  it('follows the config as it changes (read on every message)', async () => {
    let cfg: TriviaForwardConfig = { enabled: false, channelIds: [CHAN] }
    const post = vi.fn(async () => 'ok' as ForwardResult)
    const f = new TriviaForwarder({ config: () => cfg, post, sleep: async () => {}, log: () => {}, guildId: GUILD })
    f.onMessage(msg())
    cfg = ON
    f.onMessage(msg({ id: '900000000000000002' }))
    await f.idle()
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('warns once when a human message arrives with empty content (MessageContent missing), never with text', async () => {
    const { f, log } = setup()
    f.onMessage(msg({ content: '' }))
    f.onMessage(msg({ content: '' }))
    await f.idle()
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toContain('MessageContent')
  })

  it('never throws, even when the config callback does', () => {
    const f = new TriviaForwarder({ config: () => { throw new Error('boom') }, post: async () => 'ok', sleep: async () => {}, log: () => {}, guildId: GUILD })
    expect(() => f.onMessage(msg())).not.toThrow()
  })
})

describe('TriviaForwarder ordering', () => {
  it('delivers in Discord order even when earlier POSTs are slower', async () => {
    const order: string[] = []
    const delays: Record<string, number> = { '1': 30, '2': 5, '3': 1 }
    const f = new TriviaForwarder({
      config: () => ON,
      post: async (b) => {
        await new Promise((r) => setTimeout(r, delays[b.content]))
        order.push(b.content)
        return 'ok'
      },
      sleep: async () => {},
      log: () => {},
      guildId: GUILD,
    })
    for (const c of ['1', '2', '3']) f.onMessage(msg({ id: `90000000000000000${c}`, content: c }))
    await f.idle()
    expect(order).toEqual(['1', '2', '3'])
  })

  it('a retried message keeps its place: the next message waits for it', async () => {
    const calls: string[] = []
    let first = true
    const f = new TriviaForwarder({
      config: () => ON,
      post: async (b) => {
        calls.push(b.content)
        if (b.content === 'a' && first) {
          first = false
          return 'retry'
        }
        return 'ok'
      },
      sleep: async () => {},
      log: () => {},
      guildId: GUILD,
    })
    f.onMessage(msg({ id: '900000000000000001', content: 'a' }))
    f.onMessage(msg({ id: '900000000000000002', content: 'b' }))
    await f.idle()
    expect(calls).toEqual(['a', 'a', 'b'])
  })

  it('channels do not wait for each other', async () => {
    const other = '800000000000000003'
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const done: string[] = []
    const f = new TriviaForwarder({
      config: () => ({ enabled: true, channelIds: [CHAN, other] }),
      post: async (b) => {
        if (b.channelId === CHAN) await gate
        done.push(b.channelId)
        return 'ok'
      },
      sleep: async () => {},
      log: () => {},
      guildId: GUILD,
    })
    f.onMessage(msg())
    f.onMessage(msg({ id: '900000000000000002', channelId: other }))
    await new Promise((r) => setTimeout(r, 10))
    expect(done).toEqual([other])
    release()
    await f.idle()
    expect(done).toEqual([other, CHAN])
  })
})

describe('TriviaForwarder retries', () => {
  it('retries with the planned waits, then gives up and logs without the text', async () => {
    const { f, post, sleep, log } = setup(ON, ['retry', 'retry', 'retry', 'retry', 'retry'])
    f.onMessage(msg({ content: 'secret answer' }))
    await f.idle()
    expect(post).toHaveBeenCalledTimes(1 + FORWARD_RETRY_DELAYS_MS.length)
    expect(sleep.mock.calls.map((c) => c[0])).toEqual(FORWARD_RETRY_DELAYS_MS)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('gave up'))
    expect(log.mock.calls.flat().join(' ')).not.toContain('secret answer')
  })

  it('does not retry a permanent refusal', async () => {
    const { f, post, sleep } = setup(ON, ['drop'])
    f.onMessage(msg())
    await f.idle()
    expect(post).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('drops new messages when a channel queue is full', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const post = vi.fn(async () => {
      await gate
      return 'ok' as ForwardResult
    })
    const log = vi.fn()
    const f = new TriviaForwarder({ config: () => ON, post, sleep: async () => {}, log, guildId: GUILD })
    for (let i = 0; i < MAX_QUEUED_PER_CHANNEL + 5; i++) f.onMessage(msg({ id: String(900000000000000000n + BigInt(i)) }))
    expect(log).toHaveBeenCalledTimes(5)
    release()
    await f.idle()
    expect(post).toHaveBeenCalledTimes(MAX_QUEUED_PER_CHANNEL)
  })
})

describe('postTriviaAnswer', () => {
  const body: ForwardBody = { channelId: CHAN, messageId: '9', authorId: '1', content: 'true' }
  const call = (status: number | Error) =>
    postTriviaAnswer('https://app.test', 'KEY', body, (async () => {
      if (status instanceof Error) throw status
      return new Response('{}', { status })
    }) as unknown as typeof fetch)

  it('maps statuses: 200 ok; 5xx, 429, 401, 404 and network errors retry; other 4xx drop', async () => {
    expect(await call(200)).toBe('ok')
    for (const s of [500, 503, 429, 401, 403, 404, 408]) expect(await call(s)).toBe('retry')
    expect(await call(new Error('network'))).toBe('retry')
    expect(await call(400)).toBe('drop')
  })

  it('sends the bearer key and the body to the answer route', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
    await postTriviaAnswer('https://app.test', 'KEY', body, fetchImpl as unknown as typeof fetch)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://app.test/api/trivia/discord/answer')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer KEY')
    expect(JSON.parse(init.body as string)).toEqual(body)
  })
})

describe('remote config', () => {
  it('trivia is off by default and when the app is old or the shape is wrong', () => {
    expect(REMOTE_CONFIG_OFF.trivia).toEqual({ enabled: false, channelIds: [] })
    expect(parseRemoteConfig({}).trivia).toEqual({ enabled: false, channelIds: [] })
    expect(parseRemoteConfig({ trivia: 'on' }).trivia.enabled).toBe(false)
    expect(parseRemoteConfig({ trivia: { enabled: true, channelIds: [] } }).trivia.enabled).toBe(false)
    expect(parseRemoteConfig({ trivia: { enabled: true, channelIds: ['not-an-id'] } }).trivia).toEqual({ enabled: false, channelIds: [] })
  })

  it('is on only with the flag and a valid channel id', () => {
    expect(parseRemoteConfig({ trivia: { enabled: true, channelIds: [CHAN] } }).trivia).toEqual({ enabled: true, channelIds: [CHAN] })
    expect(parseRemoteConfig({ trivia: { enabled: false, channelIds: [CHAN] } }).trivia.enabled).toBe(false)
  })
})

describe('isolation from recording', () => {
  it('the forwarder module does not import the recording chain', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('./trivia-forward.ts', import.meta.url), 'utf8')
    expect(src).not.toMatch(/from '\.\/(recorder|finalize|capture)\.js'/)
  })
})
