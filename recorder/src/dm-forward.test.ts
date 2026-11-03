import { describe, expect, it, vi } from 'vitest'
const ChannelType = { DM: 1, GuildText: 0 }
import { handleDm, postFollowupInbound, type DmMessage, type InboundAnswer } from './dm-forward.js'

function msg(over: Partial<DmMessage> = {}): DmMessage & { react: ReturnType<typeof vi.fn>; channel: { type: number; send: ReturnType<typeof vi.fn> } } {
  return {
    id: '900',
    content: 'on it',
    guildId: null,
    author: { id: '111', bot: false },
    channel: { type: ChannelType.DM, send: vi.fn(async () => {}) },
    react: vi.fn(async () => {}),
    ...over,
  } as never
}
const deps = (answers: InboundAnswer[]) => {
  const post = vi.fn(async () => answers.shift() ?? ({ ok: false, retryable: false } as InboundAnswer))
  return { post, sleep: vi.fn(async () => {}), log: vi.fn() }
}

describe('handleDm', () => {
  it('ignores guild messages, bots and empty text', async () => {
    const d = deps([{ ok: true, claimed: true, ack: '' }])
    await handleDm(msg({ guildId: '5' }), d)
    await handleDm(msg({ author: { id: '1', bot: true } }), d)
    await handleDm(msg({ content: '   ' }), d)
    await handleDm(msg({ channel: { type: ChannelType.GuildText, send: vi.fn() } as never }), d)
    expect(d.post).not.toHaveBeenCalled()
  })
  it('posts with the message id as the idempotency key; an empty ack reacts', async () => {
    const m = msg()
    const d = deps([{ ok: true, claimed: true, ack: '' }])
    await handleDm(m, d)
    expect(d.post).toHaveBeenCalledWith({ senderId: '111', text: 'on it', externalKey: 'discord:900' })
    expect(m.react).toHaveBeenCalledWith('✅')
    expect(m.channel.send).not.toHaveBeenCalled()
  })
  it('a non-empty ack is sent as a reply; unclaimed or no ack does nothing', async () => {
    const m = msg()
    await handleDm(m, deps([{ ok: true, claimed: true, ack: 'Thanks' }]))
    expect(m.channel.send).toHaveBeenCalledWith('Thanks')
    const n = msg()
    await handleDm(n, deps([{ ok: true, claimed: false }]))
    await handleDm(n, deps([{ ok: true, claimed: true }]))
    expect(n.react).not.toHaveBeenCalled()
    expect(n.channel.send).not.toHaveBeenCalled()
  })
  it('retries a retryable failure with the planned waits, then gives up', async () => {
    const d = deps([{ ok: false, retryable: true }, { ok: false, retryable: true }, { ok: false, retryable: true }, { ok: false, retryable: true }])
    await handleDm(msg(), d)
    expect(d.post).toHaveBeenCalledTimes(4)
    expect(d.sleep.mock.calls.map((c) => c[0])).toEqual([5_000, 30_000, 120_000])
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining('gave up'))
  })
  it('recovers on a retry; does not retry a permanent failure', async () => {
    const m = msg()
    const d = deps([{ ok: false, retryable: true }, { ok: true, claimed: true, ack: '' }])
    await handleDm(m, d)
    expect(d.post).toHaveBeenCalledTimes(2)
    expect(m.react).toHaveBeenCalled()
    const e = deps([{ ok: false, retryable: false }])
    await handleDm(msg(), e)
    expect(e.post).toHaveBeenCalledTimes(1)
  })
  it('never throws, and never logs the message text', async () => {
    const m = msg({ content: 'secret words' })
    m.react.mockRejectedValue(new Error('missing permissions'))
    const d = deps([{ ok: true, claimed: true, ack: '' }])
    await expect(handleDm(m, d)).resolves.toBeUndefined()
    const bad = { ...deps([]), post: vi.fn(async () => { throw new Error('boom') }) }
    await expect(handleDm(m, bad)).resolves.toBeUndefined()
    for (const c of [...d.log.mock.calls, ...bad.log.mock.calls]) expect(String(c[0])).not.toContain('secret')
  })
})

describe('postFollowupInbound', () => {
  it('maps responses and network errors', async () => {
    const f = vi.spyOn(globalThis, 'fetch')
    f.mockResolvedValueOnce(new Response(JSON.stringify({ claimed: true, ack: 'x' }), { status: 200 }))
    expect(await postFollowupInbound('https://example.com', 'k', { senderId: '1', text: 't', externalKey: 'discord:1' })).toEqual({ ok: true, claimed: true, ack: 'x' })
    expect(f.mock.calls[0][0]).toBe('https://example.com/api/followups/inbound')
    f.mockResolvedValueOnce(new Response('{}', { status: 503 }))
    expect(await postFollowupInbound('https://example.com', 'k', { senderId: '1', text: 't', externalKey: 'k' })).toEqual({ ok: false, retryable: true })
    f.mockResolvedValueOnce(new Response('{}', { status: 400 }))
    expect(await postFollowupInbound('https://example.com', 'k', { senderId: '1', text: 't', externalKey: 'k' })).toEqual({ ok: false, retryable: false })
    f.mockRejectedValueOnce(new Error('net'))
    expect(await postFollowupInbound('https://example.com', 'k', { senderId: '1', text: 't', externalKey: 'k' })).toEqual({ ok: false, retryable: true })
    f.mockRestore()
  })
})
