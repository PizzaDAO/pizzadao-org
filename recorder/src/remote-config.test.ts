import { describe, expect, it, vi } from 'vitest'
import { parseRemoteConfig, REMOTE_CONFIG_OFF, RemoteConfigClient } from './remote-config.js'

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response

describe('parseRemoteConfig', () => {
  it('falls back to all-off for garbage', () => {
    expect(parseRemoteConfig(null)).toEqual(REMOTE_CONFIG_OFF)
    expect(parseRemoteConfig('x')).toEqual(REMOTE_CONFIG_OFF)
    expect(parseRemoteConfig({ welcome: { enabled: 'yes', batchSeconds: 9999 } }).welcome).toEqual(REMOTE_CONFIG_OFF.welcome)
  })
  it('only an explicit true turns a behaviour on', () => {
    const c = parseRemoteConfig({ welcome: { enabled: true, batchSeconds: 30 }, endSong: { enabled: true, minHumans: 2, crewMap: [{ crew: 'Ops', radio: 'Ops' }, { crew: '', radio: 'x' }] }, crews: [{ eventId: '1', label: 'Ops' }, { bad: 1 }] })
    expect(c.welcome.enabled).toBe(true)
    expect(c.welcome.batchSeconds).toBe(30)
    expect(c.endSong).toEqual({ enabled: true, minHumans: 2, crewMap: [{ crew: 'Ops', radio: 'Ops' }] })
    expect(c.crews).toEqual([{ eventId: '1', label: 'Ops' }])
  })
})

describe('RemoteConfigClient', () => {
  it('is all-off before any fetch and when the first fetch fails', async () => {
    const log = vi.fn()
    const c = new RemoteConfigClient('https://x', 'k', log, vi.fn().mockRejectedValue(new Error('down')) as unknown as typeof fetch)
    expect(c.get()).toEqual(REMOTE_CONFIG_OFF)
    expect(await c.refresh()).toEqual(REMOTE_CONFIG_OFF)
    expect(log).toHaveBeenCalledTimes(1)
  })
  it('keeps the last good value when a later fetch fails', async () => {
    const f = vi.fn().mockResolvedValueOnce(ok({ welcome: { enabled: true } })).mockResolvedValueOnce({ ok: false, status: 500 })
    const c = new RemoteConfigClient('https://x', 'k', () => {}, f as unknown as typeof fetch)
    expect((await c.refresh()).welcome.enabled).toBe(true)
    expect((await c.refresh()).welcome.enabled).toBe(true)
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer k')
  })
  it('treats a 401 as a failure (all-off)', async () => {
    const c = new RemoteConfigClient('https://x', 'k', () => {}, vi.fn().mockResolvedValue({ ok: false, status: 401 }) as unknown as typeof fetch)
    expect((await c.refresh()).welcome.enabled).toBe(false)
  })
})

describe('session-start wait', () => {
  it('gives up after the given wait and keeps the last good value (or all-off)', async () => {
    const slow = vi.fn((_u: string, init?: RequestInit) => new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted')))))
    const c = new RemoteConfigClient('https://x', 'k', () => {}, slow as unknown as typeof fetch)
    const t0 = Date.now()
    expect((await c.refresh(40)).welcome.enabled).toBe(false)
    expect(Date.now() - t0).toBeLessThan(1000)
  })
})

describe('supersedeMaxDeferMinutes', () => {
  it('defaults to 0 (off), accepts 0-120, rejects bad values', () => {
    expect(parseRemoteConfig({}).supersedeMaxDeferMinutes).toBe(0)
    expect(parseRemoteConfig({ supersedeMaxDeferMinutes: 30 }).supersedeMaxDeferMinutes).toBe(30)
    expect(parseRemoteConfig({ supersedeMaxDeferMinutes: 500 }).supersedeMaxDeferMinutes).toBe(0)
    expect(parseRemoteConfig({ supersedeMaxDeferMinutes: '30' }).supersedeMaxDeferMinutes).toBe(0)
  })
})
