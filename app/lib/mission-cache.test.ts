// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cachedMissionRows, clearMissionCaches, MISSION_ROWS_CACHE_MS } from './mission-cache'

const ROWS = [{ id: 1, level: 1 }]

beforeEach(() => clearMissionCaches())

describe('cachedMissionRows', () => {
  it('reuses one load within the TTL, then reloads', async () => {
    const load = vi.fn().mockResolvedValue(ROWS)
    const t0 = 1_000_000
    expect(await cachedMissionRows(load, t0)).toEqual(ROWS)
    expect(await cachedMissionRows(load, t0 + MISSION_ROWS_CACHE_MS - 1)).toEqual(ROWS)
    expect(load).toHaveBeenCalledTimes(1)
    await cachedMissionRows(load, t0 + MISSION_ROWS_CACHE_MS + 1)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('dedupes concurrent loads into one query', async () => {
    const load = vi.fn().mockResolvedValue(ROWS)
    await Promise.all([cachedMissionRows(load), cachedMissionRows(load), cachedMissionRows(load)])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('an admin edit (clearMissionCaches) forces a fresh load', async () => {
    const load = vi.fn().mockResolvedValueOnce(ROWS).mockResolvedValueOnce([{ id: 2, level: 1 }])
    await cachedMissionRows(load)
    clearMissionCaches()
    expect(await cachedMissionRows(load)).toEqual([{ id: 2, level: 1 }])
  })

  it('a load in flight when the cache is cleared does not cache its (older) rows', async () => {
    let release!: (rows: unknown[]) => void
    const load = vi.fn().mockReturnValueOnce(new Promise((r) => (release = r))).mockResolvedValueOnce([{ id: 2, level: 1 }])
    const old = cachedMissionRows(load)
    clearMissionCaches()
    release(ROWS)
    expect(await old).toEqual(ROWS)
    expect(await cachedMissionRows(load)).toEqual([{ id: 2, level: 1 }])
  })

  it('a failed load rejects and is not cached', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce(ROWS)
    await expect(cachedMissionRows(load)).rejects.toThrow('db down')
    expect(await cachedMissionRows(load)).toEqual(ROWS)
  })

  it('on expiry, an unchanged fingerprint keeps the rows without loading them again', async () => {
    const load = vi.fn().mockResolvedValue(ROWS)
    const fp = vi.fn().mockResolvedValue('aaa')
    const t0 = 2_000_000
    await cachedMissionRows(load, t0, fp)
    expect(await cachedMissionRows(load, t0 + MISSION_ROWS_CACHE_MS + 1, fp)).toEqual(ROWS)
    expect(load).toHaveBeenCalledTimes(1)
    expect(fp).toHaveBeenCalledTimes(2)
  })

  it('a changed or unreadable fingerprint loads the rows again', async () => {
    const load = vi.fn().mockResolvedValueOnce(ROWS).mockResolvedValueOnce([{ id: 2, level: 1 }]).mockResolvedValueOnce(ROWS)
    const fp = vi.fn().mockResolvedValueOnce('aaa').mockResolvedValueOnce('bbb').mockRejectedValueOnce(new Error('no raw'))
    const t0 = 3_000_000
    await cachedMissionRows(load, t0, fp)
    expect(await cachedMissionRows(load, t0 + MISSION_ROWS_CACHE_MS + 1, fp)).toEqual([{ id: 2, level: 1 }])
    expect(await cachedMissionRows(load, t0 + 2 * MISSION_ROWS_CACHE_MS + 2, fp)).toEqual(ROWS)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('an empty table is not cached (fail-closed checks keep asking)', async () => {
    const load = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(ROWS)
    expect(await cachedMissionRows(load)).toEqual([])
    expect(await cachedMissionRows(load)).toEqual(ROWS)
  })
})
