import { describe, expect, it, vi } from 'vitest'
import { MAX_REQUESTS_PER_CALL, PlayOutListener, postPlayOut, SPEAKER_CACHE_MS, type PlayOutAnswer } from './play-out.js'
import { parseRemoteConfig, REMOTE_CONFIG_OFF } from './remote-config.js'
import type { SegmentRecord } from './types.js'

const seg = (startMs: number, len = 3000, userId = '111'): SegmentRecord => ({ t: 'segment', userId, startMs, endMs: startMs + len, file: `seg/${userId}/${startMs}.ogg`, bytes: 900 })
/** `yes(n)`: the n-th command check says yes. `allowedIds`: speakers the app allows. */
const make = (yes: (n: number) => boolean, allowedIds: string[] = ['111']) => {
  let n = 0
  let t = 0
  const lookups: string[][] = []
  const post = vi.fn(async (b: { command?: string; speakers?: string[] }): Promise<PlayOutAnswer | null> => {
    if (b.command === 'play-out-allowed') {
      lookups.push(b.speakers ?? [])
      const sp = b.speakers ?? []
      return { allowed: sp.filter((s) => allowedIds.includes(s)), denied: sp.filter((s) => !allowedIds.includes(s)) }
    }
    return { playOut: yes(++n) }
  })
  const onCommand = vi.fn()
  const put = vi.fn(async () => 1)
  const remove = vi.fn(async () => undefined)
  const l = new PlayOutListener({ sessionId: 'evt1-1700000000000', eventId: '1', eventName: 'x', startedAtMs: 0, dir: '/d', uploader: { put, remove }, post: post as never, onCommand, log: () => {}, now: () => t })
  return { l, post, onCommand, put, remove, lookups, advance: (ms: number) => (t += ms) }
}
const settle = () => new Promise((r) => setTimeout(r, 10))
const checks = (post: { mock: { calls: unknown[][] } }) => post.mock.calls.filter((c) => (c[0] as { command: string }).command === 'play-out').length

describe('PlayOutListener', () => {
  it('uploads an allowed speaker\'s burst, asks the app, deletes the burst, and fires once on yes', async () => {
    const { l, onCommand, put, remove } = make(() => true)
    l.onSegment(seg(1000))
    await settle()
    expect(put).toHaveBeenCalledWith('calls/evt1-1700000000000/cmd/111/1000.ogg', expect.any(String), 'audio/ogg')
    expect(remove).toHaveBeenCalledWith('calls/evt1-1700000000000/cmd/111/1000.ogg')
    l.onSegment(seg(9000))
    await settle()
    expect(onCommand).toHaveBeenCalledTimes(1)
  })
  it('never uploads a speaker the app does not allow, and asks about each speaker only once', async () => {
    const { l, put, post, lookups } = make(() => true, ['111'])
    l.onSegment(seg(1000, 3000, '222'))
    await settle()
    l.onSegment(seg(9000, 3000, '222'))
    l.onSegment(seg(20000, 3000, '222'))
    await settle()
    expect(put).not.toHaveBeenCalled()
    expect(checks(post)).toBe(0)
    expect(lookups).toEqual([['222']])
  })
  it('re-asks after the cache expires, and does not cache a failed lookup', async () => {
    const { l, lookups, advance, post } = make(() => false)
    l.onSegment(seg(1000))
    await settle()
    advance(SPEAKER_CACHE_MS + 1)
    l.onSegment(seg(9000))
    await settle()
    expect(lookups).toHaveLength(2)
    post.mockImplementation(async () => null)
    const b = make(() => false)
    b.post.mockImplementation(async () => null)
    b.l.onSegment(seg(1000, 3000, '333'))
    await settle()
    b.l.onSegment(seg(9000, 3000, '333'))
    await settle()
    expect(b.put).not.toHaveBeenCalled()
    expect(b.post).toHaveBeenCalledTimes(2) // asked again: the failure was not remembered
  })
  it('keeps listening after a no', async () => {
    const { l, onCommand, post } = make((n) => n === 2)
    l.onSegment(seg(1000))
    await settle()
    l.onSegment(seg(9000))
    await settle()
    expect(checks(post)).toBe(2)
    expect(onCommand).toHaveBeenCalledTimes(1)
  })
  it('skips short and long bursts, and does nothing once stopped', async () => {
    const { l, post } = make(() => true)
    l.onSegment(seg(0, 400))
    l.onSegment(seg(0, 60_000))
    l.stop()
    l.onSegment(seg(5000))
    await settle()
    expect(post).not.toHaveBeenCalled()
  })
  it('caps the checks per call', async () => {
    const { l, post } = make(() => false)
    for (let i = 0; i < MAX_REQUESTS_PER_CALL + 20; i++) {
      l.onSegment(seg(i * 10_000))
      await settle()
    }
    expect(checks(post)).toBe(MAX_REQUESTS_PER_CALL)
  })
})

describe('postPlayOut', () => {
  const body = { sessionId: 's', eventId: null, eventName: null, startedAt: '', command: 'play-out' as const }
  const f = (res: Partial<Response>) => vi.fn(async () => res as Response)
  it('parses the answer, and is null on any failure', async () => {
    expect((await postPlayOut('https://a', 'k', body, () => {}, f({ ok: true, json: async () => ({ playOut: true }) })))?.playOut).toBe(true)
    expect((await postPlayOut('https://a', 'k', body, () => {}, f({ ok: true, json: async () => ({ allowed: ['1'], denied: ['2'] }) })))).toMatchObject({ playOut: false, allowed: ['1'], denied: ['2'] })
    expect(await postPlayOut('https://a', 'k', body, () => {}, f({ ok: false, status: 500 }))).toBeNull()
    expect(await postPlayOut('https://a', 'k', body, () => {}, vi.fn(async () => { throw new Error('down') }))).toBeNull()
  })
})

describe('parseRemoteConfig playOut', () => {
  it('is off by default and only an explicit true turns it on', () => {
    expect(parseRemoteConfig({}).playOut).toEqual(REMOTE_CONFIG_OFF.playOut)
    expect(parseRemoteConfig({ playOut: { enabled: 'yes' } }).playOut.enabled).toBe(false)
    expect(parseRemoteConfig({ playOut: { enabled: true } }).playOut.enabled).toBe(true)
  })
})
