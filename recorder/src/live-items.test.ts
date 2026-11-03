import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHAT_BATCH_MS, chatActionText, LiveItems, MIN_POST_GAP_MS, postLive, type LiveItemsDeps, type LiveRequest } from './live-items.js'
import { parseRemoteConfig, REMOTE_CONFIG_OFF } from './remote-config.js'
import type { SegmentRecord } from './types.js'

const SID = 'evt1-1700000000000'
const seg = (over: Partial<SegmentRecord> = {}): SegmentRecord => ({ t: 'segment', userId: '111', startMs: 1000, endMs: 4000, file: 'seg/111/1000.ogg', bytes: 900, ...over })

function make(cfg: Partial<LiveItemsDeps['cfg']> = {}, over: Partial<LiveItemsDeps> = {}) {
  const sent: string[] = []
  const bodies: LiveRequest[] = []
  const put = vi.fn(async () => 100)
  const post = vi.fn(async (b: LiveRequest) => {
    bodies.push(b)
    return ['📝 Action item recorded: x']
  })
  const live = new LiveItems({
    sessionId: SID,
    eventId: '100000000000000001',
    eventName: 'Ops call',
    startedAtMs: 1_700_000_000_000,
    dir: '/data/s',
    cfg: { audio: true, chunkSeconds: 120, chat: true, prefixes: ['action:', 'todo:'], eventIds: ['100000000000000001'], ...cfg },
    uploader: { put },
    post,
    send: async (t) => {
      sent.push(t)
      return true
    },
    nameOf: (id) => (id === '111' ? 'Ann' : null),
    log: () => {},
    ...over,
  })
  return { live, sent, bodies, put, post }
}

describe('chatActionText', () => {
  it('matches a prefix case-insensitively and returns the rest', () => {
    expect(chatActionText('Action: book the venue', ['action:'])).toBe('book the venue')
    expect(chatActionText('  TODO:  write it up ', ['action:', 'todo:'])).toBe('write it up')
  })
  it('ignores other messages and empty items', () => {
    expect(chatActionText('my action: none', ['action:'])).toBeNull()
    expect(chatActionText('action:  ', ['action:'])).toBeNull()
    expect(chatActionText('action: x', ['action:'])).toBeNull()
    expect(chatActionText('action: book', [])).toBeNull()
  })
})

describe('parseRemoteConfig liveItems', () => {
  it('is off by default and for garbage', () => {
    expect(parseRemoteConfig({}).liveItems).toEqual(REMOTE_CONFIG_OFF.liveItems)
    expect(parseRemoteConfig({ liveItems: { audio: 'yes', chat: 1, chunkSeconds: 5 } }).liveItems).toEqual(REMOTE_CONFIG_OFF.liveItems)
  })
  it('needs an allowlisted event (and prefixes for chat)', () => {
    expect(parseRemoteConfig({ liveItems: { audio: true, chat: true, prefixes: ['action:'], eventIds: [] } }).liveItems.audio).toBe(false)
    const l = parseRemoteConfig({ liveItems: { audio: true, chat: true, prefixes: [], eventIds: ['100000000000000001', 'bad'] } }).liveItems
    expect(l).toMatchObject({ audio: true, chat: false, eventIds: ['100000000000000001'] })
    expect(parseRemoteConfig({ liveItems: { chat: true, prefixes: ['Action:'], eventIds: ['100000000000000001'], chunkSeconds: 90 } }).liveItems).toEqual({
      audio: false,
      chat: true,
      prefixes: ['action:'],
      eventIds: ['100000000000000001'],
      chunkSeconds: 90,
    })
  })
})

describe('LiveItems speech chunks', () => {
  it('uploads the new segments under the session prefix and posts what the app returns', async () => {
    const { live, sent, bodies, put } = make()
    live.onSegment(seg())
    live.onSegment(seg({ userId: '222', startMs: 2000, endMs: 2100, file: 'seg/222/2000.ogg' })) // too short
    live.onSegment(seg({ bytes: 0 })) // empty
    await live.cut()
    expect(put).toHaveBeenCalledWith(`calls/${SID}/live/111/1000.ogg`, '/data/s/seg/111/1000.ogg', 'audio/ogg')
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ sessionId: SID, seq: 1, segments: [{ discordId: '111', displayName: 'Ann', key: `calls/${SID}/live/111/1000.ogg`, startMs: 1000, endMs: 4000 }] })
    expect(sent).toEqual(['📝 Action item recorded: x'])
    await live.cut() // nothing new: no request
    expect(bodies).toHaveLength(1)
    live.onSegment(seg({ startMs: 9000, endMs: 12_000 }))
    await live.cut()
    expect(bodies[1].seq).toBe(2)
  })

  it('skips a segment whose upload fails, and sends nothing when none uploaded', async () => {
    const put = vi.fn(async () => {
      throw new Error('r2 down')
    })
    const { live, bodies } = make({}, { uploader: { put } })
    live.onSegment(seg())
    await live.cut()
    expect(bodies).toHaveLength(0)
  })

  it('never posts after the session stopped (the channel may belong to the next call)', async () => {
    let release: (v: string[]) => void = () => {}
    const post = vi.fn(() => new Promise<string[]>((r) => (release = r)))
    const { live, sent } = make({}, { post })
    live.onSegment(seg())
    const p = live.cut()
    await vi.waitFor(() => expect(post).toHaveBeenCalled())
    live.stop()
    release(['📝 late'])
    await p
    expect(sent).toEqual([])
  })

  it('collects no speech when audio is off', async () => {
    const { live, bodies } = make({ audio: false })
    live.onSegment(seg())
    await live.cut()
    expect(bodies).toHaveLength(0)
  })
})

describe('LiveItems chat', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('batches prefixed lines typed close together into one request', async () => {
    const { live, bodies, sent } = make()
    live.onChat({ discordId: '111', displayName: 'Ann', messageId: 'm1', text: 'action: book the venue', atMs: 1000 })
    live.onChat({ discordId: '111', displayName: 'Ann', messageId: 'm2', text: 'just chatting', atMs: 1100 })
    live.onChat({ discordId: '111', displayName: 'Ann', messageId: 'm3', text: 'todo: send the deck', atMs: 1200 })
    await vi.advanceTimersByTimeAsync(CHAT_BATCH_MS + 10)
    expect(bodies).toHaveLength(1)
    expect(bodies[0].chat?.map((c) => c.messageId)).toEqual(['m1', 'm3'])
    expect(bodies[0].seq).toBeUndefined()
    expect(sent).toHaveLength(1)
  })

  it('keeps posts at least MIN_POST_GAP_MS apart', async () => {
    const { live, bodies } = make()
    live.onChat({ discordId: '111', displayName: 'Ann', messageId: 'm1', text: 'action: one thing', atMs: 1 })
    await vi.advanceTimersByTimeAsync(CHAT_BATCH_MS + 10)
    live.onChat({ discordId: '111', displayName: 'Ann', messageId: 'm2', text: 'action: two things', atMs: 2 })
    await vi.advanceTimersByTimeAsync(CHAT_BATCH_MS + 10)
    expect(bodies).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(MIN_POST_GAP_MS)
    expect(bodies).toHaveLength(2)
  })

  it('drops queued chat on stop and ignores chat when off', async () => {
    const a = make()
    a.live.onChat({ discordId: '111', displayName: null, messageId: 'm1', text: 'action: one thing', atMs: 1 })
    a.live.stop()
    await vi.advanceTimersByTimeAsync(CHAT_BATCH_MS + 10)
    expect(a.bodies).toHaveLength(0)
    const b = make({ chat: false })
    b.live.onChat({ discordId: '111', displayName: null, messageId: 'm1', text: 'action: one thing', atMs: 1 })
    await vi.advanceTimersByTimeAsync(CHAT_BATCH_MS + 10)
    expect(b.bodies).toHaveLength(0)
  })
})

describe('postLive', () => {
  const body: LiveRequest = { sessionId: SID, eventId: null, eventName: null, startedAt: new Date(0).toISOString() }
  it('returns the messages, at most three', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ messages: ['a', 'b', '', 3, 'c', 'd'] }) }) as unknown as Response)
    expect(await postLive('https://app', 'k', body, () => {}, f as unknown as typeof fetch)).toEqual(['a', 'b', 'c'])
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k')
  })
  it('returns nothing on an error status or a network failure', async () => {
    const log = vi.fn()
    expect(await postLive('https://app', 'k', body, log, (async () => ({ ok: false, status: 500 })) as unknown as typeof fetch)).toEqual([])
    expect(await postLive('https://app', 'k', body, log, (async () => { throw new Error('down') }) as unknown as typeof fetch)).toEqual([])
    expect(log).toHaveBeenCalledTimes(2)
  })
})
