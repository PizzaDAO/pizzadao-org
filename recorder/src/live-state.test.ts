import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHANGE_DEBOUNCE_MS, findStreamLink, LiveStatePusher, MAX_PRESENCE, normalizeStreamLink, OFF_RETRY_MS, PresenceClock, postLiveState, type LiveStateBody, type PostResult } from './live-state.js'
import { parseRemoteConfig } from './remote-config.js'

describe('findStreamLink', () => {
  it('finds x.com broadcast and status links, the first one wins', () => {
    expect(findStreamLink('live now https://x.com/i/broadcasts/1abcDEF and https://x.com/pizzadao/status/123')).toBe('https://x.com/i/broadcasts/1abcDEF')
    expect(findStreamLink('watch: https://twitter.com/pizzadao/status/1234567890.')).toBe('https://twitter.com/pizzadao/status/1234567890')
    expect(findStreamLink('https://www.x.com/pizzadao/status/42?s=20')).toBe('https://www.x.com/pizzadao/status/42')
  })
  it('ignores other hosts, other paths, http and lookalikes', () => {
    expect(findStreamLink('https://example.com/i/broadcasts/abc')).toBeNull()
    expect(findStreamLink('http://x.com/i/broadcasts/abc')).toBeNull()
    expect(findStreamLink('https://x.com/pizzadao')).toBeNull()
    expect(findStreamLink('https://x.com.evil.test/i/broadcasts/abc')).toBeNull()
    expect(findStreamLink('https://user:pw@x.com/i/broadcasts/abc')).toBeNull()
    expect(normalizeStreamLink('nope')).toBeNull()
  })
})

describe('PresenceClock', () => {
  it('adds up time only while a person is in the channel, across rejoins', () => {
    const c = new PresenceClock()
    c.update(['a', 'b'], 0)
    c.update(['a'], 60_000) // b left after 60 s
    c.update(['a', 'b'], 120_000) // b is back
    const snap = c.snapshot(180_000)
    const by = Object.fromEntries(snap.map((p) => [p.discordId, p]))
    expect(by.a.presentSec).toBe(180)
    expect(by.b.presentSec).toBe(120)
    expect(by.b.inChannel).toBe(true)
  })
  it('keeps people who left, marked out of the channel, and reports whether the set changed', () => {
    const c = new PresenceClock()
    expect(c.update(['a'], 0)).toBe(true)
    expect(c.update(['a'], 10_000)).toBe(false)
    expect(c.update([], 20_000)).toBe(true)
    expect(c.snapshot(30_000)).toEqual([{ discordId: 'a', displayName: null, presentSec: 20, inChannel: false }])
  })
  it('caps the list, keeping people still here', () => {
    const c = new PresenceClock()
    const ids = Array.from({ length: MAX_PRESENCE + 20 }, (_, i) => String(100000000000000 + i))
    c.update(ids, 0)
    c.update(ids.slice(0, 5), 1000)
    const snap = c.snapshot(2000)
    expect(snap).toHaveLength(MAX_PRESENCE)
    expect(snap.slice(0, 5).every((p) => p.inChannel)).toBe(true)
  })
})

describe('LiveStatePusher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  const make = (result: PostResult = 'ok') => {
    const post = vi.fn(async (_b: LiveStateBody) => result)
    const p = new LiveStatePusher({ sessionId: 's-1', eventId: '1', eventName: 'Call', channelId: '2', startedAtMs: 0, pushSeconds: 20, post })
    return { p, post }
  }

  it('sends at start, every push interval, and shortly after a join or leave', async () => {
    const { p, post } = make()
    p.start()
    expect(post).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(post).toHaveBeenCalledTimes(2)
    p.setPresent(['111111111111111'])
    p.setPresent(['111111111111111', '222222222222222'])
    expect(post).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(CHANGE_DEBOUNCE_MS)
    expect(post).toHaveBeenCalledTimes(3) // two changes, one request
    expect(post.mock.calls[2][0].present.map((x) => x.discordId)).toEqual(['111111111111111', '222222222222222'])
    p.stop()
  })

  it('sends the first stream link from the chat once, and never replaces it', async () => {
    const { p, post } = make()
    p.start()
    p.onChat('hello everyone')
    expect(post).toHaveBeenCalledTimes(1)
    p.onChat('stream: https://x.com/i/broadcasts/1abc')
    p.onChat('also https://x.com/i/broadcasts/2zzz')
    await vi.advanceTimersByTimeAsync(0)
    expect(p.link).toBe('https://x.com/i/broadcasts/1abc')
    expect(post.mock.calls.at(-1)?.[0].streamLink).toBe('https://x.com/i/broadcasts/1abc')
    p.stop()
  })

  it('sends ended at stop and nothing after', async () => {
    const { p, post } = make()
    p.start()
    await p.stop()
    expect(post.mock.calls.at(-1)?.[0].ended).toBe(true)
    const n = post.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    p.setPresent(['111111111111111'])
    expect(post).toHaveBeenCalledTimes(n)
  })

  it('goes quiet for a while when the app says the live view is off', async () => {
    const { p, post } = make('off')
    p.start()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(post).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(OFF_RETRY_MS)
    expect(post.mock.calls.length).toBeGreaterThan(1)
    p.stop()
  })
})

describe('postLiveState', () => {
  const body = { sessionId: 's', eventId: null, eventName: null, channelId: '1', startedAt: new Date(0).toISOString(), present: [] }
  it('maps 204 to off, other failures to error, and never throws', async () => {
    const log = vi.fn()
    expect(await postLiveState('https://app', 'k', body, log, (async () => new Response(null, { status: 204 })) as typeof fetch)).toBe('off')
    expect(await postLiveState('https://app', 'k', body, log, (async () => new Response('x', { status: 500 })) as typeof fetch)).toBe('error')
    expect(await postLiveState('https://app', 'k', body, log, (async () => { throw new Error('down') }) as typeof fetch)).toBe('error')
    expect(await postLiveState('https://app', 'k', body, log, (async () => new Response('{}', { status: 200 })) as typeof fetch)).toBe('ok')
  })
  it('sends the bearer key', async () => {
    const f = vi.fn(async () => new Response('{}'))
    await postLiveState('https://app', 'secret', body, () => {}, f as unknown as typeof fetch)
    expect((f.mock.calls[0] as unknown[])[0]).toBe('https://app/api/calls/recorder/live-state')
    expect(((f.mock.calls[0] as unknown[])[1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer secret' })
  })
})

describe('remote config liveView', () => {
  it('is off by default and validates the interval', () => {
    expect(parseRemoteConfig({}).liveView).toEqual({ enabled: false, pushSeconds: 20 })
    expect(parseRemoteConfig({ liveView: { enabled: true, pushSeconds: 30 } }).liveView).toEqual({ enabled: true, pushSeconds: 30 })
    expect(parseRemoteConfig({ liveView: { enabled: true, pushSeconds: 1 } }).liveView.pushSeconds).toBe(20)
  })
})
