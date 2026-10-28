// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/app/lib/db')

import { prisma } from '@/app/lib/db'
import { clearSettingsCache, getSetting, loadSettings, SETTINGS_CACHE_MS } from './index'

const findMany = vi.mocked(prisma.appSetting.findMany)

beforeEach(() => {
  clearSettingsCache({ all: true })
  findMany.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('settings read path', () => {
  it('with no rows, every setting is its code default', async () => {
    findMany.mockResolvedValue([])
    const s = await loadSettings()
    expect(s.get('calls.transcriptMinLevel')).toBe(6)
    expect(s.get('missions.humanReleaseMinLevel')).toBe(6)
    expect(s.get('missions.newAccountDays')).toBe(30)
    expect(s.get('missions.dprOnlyMinLevel')).toBe(8)
    expect(s.get('disavow.minLevel')).toBe(5)
    expect(s.readFailed).toBe(false)
  })

  it('returns an override', async () => {
    findMany.mockResolvedValue([{ key: 'calls.transcriptMinLevel', value: 9 }] as never)
    expect(await getSetting('calls.transcriptMinLevel')).toBe(9)
  })

  it('caches for ~30s with a single query, then re-reads', async () => {
    findMany.mockResolvedValue([])
    const t0 = 1_000_000
    await loadSettings(t0)
    await loadSettings(t0 + SETTINGS_CACHE_MS - 1)
    expect(findMany).toHaveBeenCalledTimes(1)
    await loadSettings(t0 + SETTINGS_CACHE_MS + 1)
    expect(findMany).toHaveBeenCalledTimes(2)
  })

  it('clearSettingsCache forces a fresh read', async () => {
    findMany.mockResolvedValueOnce([{ key: 'missions.maxAttempts', value: 5 }] as never)
    expect(await getSetting('missions.maxAttempts')).toBe(5)
    clearSettingsCache()
    findMany.mockResolvedValueOnce([] as never)
    expect(await getSetting('missions.maxAttempts')).toBe(3)
  })

  it('dedupes concurrent loads into one query', async () => {
    findMany.mockResolvedValue([])
    await Promise.all([loadSettings(), loadSettings(), loadSettings()])
    expect(findMany).toHaveBeenCalledTimes(1)
  })

  it('an invalid stored value falls back per its failure mode and is flagged, never throws', async () => {
    findMany.mockResolvedValue([
      { key: 'missions.humanReleaseMinLevel', value: 9 }, // loosening beyond today's bound
      { key: 'missions.dprOnlyMinLevel', value: 'x' },
      { key: 'calls.transcriptMinLevel', value: 99 },
      { key: 'not.a.setting', value: 1 },
    ] as never)
    const s = await loadSettings()
    expect(s.get('missions.humanReleaseMinLevel')).toBe(1) // strictest
    expect(s.get('missions.dprOnlyMinLevel')).toBe(1) // strictest
    expect(s.get('calls.transcriptMinLevel')).toBe(6) // no last-known-good yet: default
    expect(s.invalidKeys).toEqual(expect.arrayContaining(['missions.humanReleaseMinLevel', 'missions.dprOnlyMinLevel', 'calls.transcriptMinLevel']))
  })

  it('DB unreachable: strictest values for money holds, last-known-good (else default) for the rest', async () => {
    findMany.mockResolvedValueOnce([{ key: 'calls.transcriptMinLevel', value: 8 }] as never)
    expect(await getSetting('calls.transcriptMinLevel')).toBe(8)
    clearSettingsCache() // keep last-known-good
    findMany.mockRejectedValue(new Error('db down'))
    const s = await loadSettings()
    expect(s.readFailed).toBe(true)
    expect(s.get('missions.humanReleaseMinLevel')).toBe(1) // every auto-pass waits for a human
    expect(s.get('missions.newAccountDays')).toBe(365)
    expect(s.get('missions.dprOnlyMinLevel')).toBe(1)
    expect(s.get('calls.transcriptMinLevel')).toBe(8) // last known good
    expect(s.get('disavow.minLevel')).toBe(5) // never loaded: the reviewed default
  })

  it('a failed read is cached only briefly so recovery is quick', async () => {
    findMany.mockRejectedValueOnce(new Error('db down'))
    const t0 = 5_000_000
    expect((await loadSettings(t0)).readFailed).toBe(true)
    findMany.mockResolvedValue([])
    expect((await loadSettings(t0 + 1000)).readFailed).toBe(true) // still the cached failure
    const later = await loadSettings(t0 + 6000)
    expect(later.readFailed).toBe(false)
  })

  it('a missing appSetting table/client is treated as a read failure, not a crash', async () => {
    findMany.mockImplementation((() => {
      throw new Error('relation "AppSetting" does not exist')
    }) as never)
    const s = await loadSettings()
    expect(s.get('missions.humanReleaseMinLevel')).toBe(1)
  })
})
