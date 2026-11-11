import { describe, expect, it, vi } from 'vitest'
import { MAX_REQUESTS_PER_CALL, PlayOutListener, postPlayOutCheck } from './play-out.js'
import { parseRemoteConfig, REMOTE_CONFIG_OFF } from './remote-config.js'
import type { SegmentRecord } from './types.js'

const seg = (startMs: number, len = 3000): SegmentRecord => ({ t: 'segment', userId: '111', startMs, endMs: startMs + len, file: `seg/111/${startMs}.ogg`, bytes: 900 })
const make = (answer: (n: number) => boolean) => {
  let n = 0
  const check = vi.fn(async () => answer(++n))
  const onCommand = vi.fn()
  const put = vi.fn(async () => 1)
  const l = new PlayOutListener({ sessionId: 'evt1-1700000000000', eventId: '1', eventName: 'x', startedAtMs: 0, dir: '/d', uploader: { put }, check, onCommand, log: () => {} })
  return { l, check, onCommand, put }
}
const settle = () => new Promise((r) => setTimeout(r, 10))

describe('PlayOutListener', () => {
  it('uploads the burst, asks the app, and fires once on yes', async () => {
    const { l, check, onCommand, put } = make(() => true)
    l.onSegment(seg(1000))
    await settle()
    expect(put).toHaveBeenCalledTimes(1)
    expect(l.uploaded.has('calls/evt1-1700000000000/live/111/1000.ogg')).toBe(true)
    l.onSegment(seg(9000))
    await settle()
    expect(check).toHaveBeenCalledTimes(1)
    expect(onCommand).toHaveBeenCalledTimes(1)
  })
  it('keeps listening after a no', async () => {
    const { l, check, onCommand } = make((n) => n === 2)
    l.onSegment(seg(1000))
    await settle()
    l.onSegment(seg(9000))
    await settle()
    expect(check).toHaveBeenCalledTimes(2)
    expect(onCommand).toHaveBeenCalledTimes(1)
  })
  it('skips short and long bursts, and does nothing once stopped', async () => {
    const { l, check } = make(() => true)
    l.onSegment(seg(0, 400))
    l.onSegment(seg(0, 60_000))
    l.stop()
    l.onSegment(seg(5000))
    await settle()
    expect(check).not.toHaveBeenCalled()
  })
  it('caps the requests per call', async () => {
    const { l, check } = make(() => false)
    for (let i = 0; i < MAX_REQUESTS_PER_CALL + 20; i++) {
      l.onSegment(seg(i * 10_000))
      await settle()
    }
    expect(check.mock.calls.length).toBe(MAX_REQUESTS_PER_CALL)
  })
})

describe('postPlayOutCheck', () => {
  const body = { sessionId: 's', eventId: null, eventName: null, startedAt: '', command: 'play-out' as const }
  it('is true only when the app says playOut: true', async () => {
    const f = (res: Partial<Response>) => vi.fn(async () => res as Response)
    expect(await postPlayOutCheck('https://a', 'k', body, () => {}, f({ ok: true, json: async () => ({ playOut: true }) }))).toBe(true)
    expect(await postPlayOutCheck('https://a', 'k', body, () => {}, f({ ok: true, json: async () => ({ messages: [] }) }))).toBe(false)
    expect(await postPlayOutCheck('https://a', 'k', body, () => {}, f({ ok: false, status: 500 }))).toBe(false)
    expect(await postPlayOutCheck('https://a', 'k', body, () => {}, vi.fn(async () => { throw new Error('down') }))).toBe(false)
  })
})

describe('parseRemoteConfig playOut', () => {
  it('is off by default and only an explicit true turns it on', () => {
    expect(parseRemoteConfig({}).playOut).toEqual(REMOTE_CONFIG_OFF.playOut)
    expect(parseRemoteConfig({ playOut: { enabled: 'yes' } }).playOut.enabled).toBe(false)
    expect(parseRemoteConfig({ playOut: { enabled: true } }).playOut.enabled).toBe(true)
  })
})
