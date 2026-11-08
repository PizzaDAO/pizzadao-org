import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { EndSongMarker, isEndSongStop, MARKER_KEEP_MS, postPlayCrew } from './end-song.js'
import { matchesStartBand, postPlayBand } from './start-band.js'

const res = (status: number) => ({ ok: status < 300, status }) as Response
const noSleep = async () => {}

describe('postPlayCrew', () => {
  it('posts the crew with the bearer key', async () => {
    const f = vi.fn().mockResolvedValue(res(200))
    expect(await postPlayCrew('https://r/', 'k', 'Ops', '823', () => {}, f as unknown as typeof fetch, noSleep)).toBe('ok')
    expect(f.mock.calls[0][0]).toBe('https://r/play-crew')
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer k')
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ crew: 'Ops', channelId: '823' })
  })
  it('retries once on a 5xx or network error, not on a 4xx', async () => {
    const a = vi.fn().mockResolvedValueOnce(res(502)).mockResolvedValueOnce(res(200))
    expect(await postPlayCrew('https://r', 'k', 'Ops', null, () => {}, a as unknown as typeof fetch, noSleep)).toBe('ok')
    expect(a).toHaveBeenCalledTimes(2)
    const b = vi.fn().mockRejectedValue(new Error('x'))
    expect(await postPlayCrew('https://r', 'k', 'Ops', null, () => {}, b as unknown as typeof fetch, noSleep)).toBe('failed')
    expect(b).toHaveBeenCalledTimes(2)
    const c = vi.fn().mockResolvedValue(res(400))
    expect(await postPlayCrew('https://r', 'k', 'Nope', null, () => {}, c as unknown as typeof fetch, noSleep)).toBe('rejected')
    expect(c).toHaveBeenCalledTimes(1)
  })
})

describe('stop reasons and marker', () => {
  it('only event-ended counts (not the recording cap)', () => {
    expect(isEndSongStop('event-ended')).toBe(true)
    expect(['max-duration', 'empty', 'superseded', 'shutdown', 'disconnected'].some(isEndSongStop)).toBe(false)
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

describe('postPlayBand / matchesStartBand', () => {
  it('posts channelId and maxSongs with the bearer key, retrying once on a 5xx', async () => {
    const f = vi.fn().mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(200))
    expect(await postPlayBand('https://r/', 'k', '823', 2, () => {}, f as unknown as typeof fetch, noSleep)).toBe('ok')
    expect(f).toHaveBeenCalledTimes(2)
    expect(f.mock.calls[0][0]).toBe('https://r/play-band')
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer k')
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ channelId: '823', maxSongs: 2 })
    const c = vi.fn().mockResolvedValue(res(401))
    expect(await postPlayBand('https://r', 'k', '823', 1, () => {}, c as unknown as typeof fetch, noSleep)).toBe('rejected')
    expect(c).toHaveBeenCalledTimes(1)
    const n = vi.fn().mockRejectedValue(new Error('x'))
    expect(await postPlayBand('https://r', 'k', '823', 1, () => {}, n as unknown as typeof fetch, noSleep)).toBe('failed')
  })
  it('matches whole names, case-insensitively, ignoring blanks', () => {
    expect(matchesStartBand(['Community Call'], 'community call')).toBe(true)
    expect(matchesStartBand(['Community Call'], 'Community Call Extra')).toBe(false)
    expect(matchesStartBand(['Ops Crew'], 'x', 'ops crew')).toBe(true)
    expect(matchesStartBand(['', '  '], '', undefined)).toBe(false)
  })
})
