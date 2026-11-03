import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { EndSongMarker, isEndSongStop, MARKER_KEEP_MS, postPlayCrew } from './end-song.js'

const res = (status: number) => ({ ok: status < 300, status }) as Response
const noSleep = async () => {}

describe('postPlayCrew', () => {
  it('posts the crew with the bearer key', async () => {
    const f = vi.fn().mockResolvedValue(res(200))
    expect(await postPlayCrew('https://r/', 'k', 'Ops', () => {}, f as unknown as typeof fetch, noSleep)).toBe(true)
    expect(f.mock.calls[0][0]).toBe('https://r/play-crew')
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer k')
  })
  it('retries once on a 5xx or network error, not on a 4xx', async () => {
    const a = vi.fn().mockResolvedValueOnce(res(502)).mockResolvedValueOnce(res(200))
    expect(await postPlayCrew('https://r', 'k', 'Ops', () => {}, a as unknown as typeof fetch, noSleep)).toBe(true)
    expect(a).toHaveBeenCalledTimes(2)
    const b = vi.fn().mockRejectedValue(new Error('x'))
    expect(await postPlayCrew('https://r', 'k', 'Ops', () => {}, b as unknown as typeof fetch, noSleep)).toBe(false)
    expect(b).toHaveBeenCalledTimes(2)
    const c = vi.fn().mockResolvedValue(res(400))
    expect(await postPlayCrew('https://r', 'k', 'Nope', () => {}, c as unknown as typeof fetch, noSleep)).toBe(false)
    expect(c).toHaveBeenCalledTimes(1)
  })
})

describe('stop reasons and marker', () => {
  it('only event-ended and max-duration count', () => {
    expect(['event-ended', 'max-duration'].every(isEndSongStop)).toBe(true)
    expect(['empty', 'superseded', 'shutdown', 'disconnected'].some(isEndSongStop)).toBe(false)
  })
  it('persists and forgets old entries', () => {
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'es-')), 'end-song.json')
    const m = new EndSongMarker(file, () => {})
    m.mark('a:1', 1000)
    expect(new EndSongMarker(file, () => {}).has('a:1')).toBe(true)
    m.mark('b:2', 1000 + MARKER_KEEP_MS + 1)
    expect(new EndSongMarker(file, () => {}).has('a:1')).toBe(false)
  })
})
