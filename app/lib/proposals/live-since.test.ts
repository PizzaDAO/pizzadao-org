// @vitest-environment node
// The go-live moment is written once, only in production, only with the switch ON and an empty pilot list.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  settings: null as unknown as Record<string, unknown>,
  set: new Set<string>(),
  readFailed: false,
  save: vi.fn(),
}))
vi.mock('@/app/lib/settings', () => ({
  loadSettings: async () => ({ readFailed: m.readFailed, invalidKeys: [], isSet: (k: string) => m.set.has(k), get: (k: string) => m.settings[k] }),
}))
vi.mock('@/app/lib/settings/store', () => ({ saveSetting: m.save }))

import { maybeRecordLiveSince } from './live-since'
import { pilotAllows } from './pilot'

const prod = { VERCEL_ENV: 'production' } as unknown as NodeJS.ProcessEnv
const now = new Date('2026-12-01T18:00:00Z')

beforeEach(() => {
  m.settings = { 'proposals.enabled': true, 'proposals.pilotDiscordIds': [], 'proposals.liveSince': '' }
  m.set = new Set(['proposals.enabled'])
  m.readFailed = false
  m.save.mockReset()
  m.save.mockResolvedValue({ updatedAt: now })
})

describe('maybeRecordLiveSince', () => {
  it('records the moment once, insert-only, when the switch is on and the pilot list is empty', async () => {
    expect(await maybeRecordLiveSince('admin1', now, prod)).toBe(true)
    expect(m.save).toHaveBeenCalledWith('proposals.liveSince', '2026-12-01T18:00:00.000Z', 'admin1', expect.objectContaining({ expectedUpdatedAt: null }))
  })

  it('does not record while a pilot runs, while the switch is off, on previews, on read failures or when already set', async () => {
    m.settings['proposals.pilotDiscordIds'] = ['100000000000000001']
    expect(await maybeRecordLiveSince('a', now, prod)).toBe(false)
    m.settings['proposals.pilotDiscordIds'] = []
    m.settings['proposals.enabled'] = false
    expect(await maybeRecordLiveSince('a', now, prod)).toBe(false)
    m.settings['proposals.enabled'] = true
    expect(await maybeRecordLiveSince('a', now, { VERCEL_ENV: 'preview' } as unknown as NodeJS.ProcessEnv)).toBe(false)
    expect(await maybeRecordLiveSince('a', now, { ...prod, PROPOSALS_ENABLED: '0' } as unknown as NodeJS.ProcessEnv)).toBe(false)
    m.readFailed = true
    expect(await maybeRecordLiveSince('a', now, prod)).toBe(false)
    m.readFailed = false
    m.set.add('proposals.liveSince')
    expect(await maybeRecordLiveSince('a', now, prod)).toBe(false)
    expect(m.save).not.toHaveBeenCalled()
  })

  it('never throws when the save loses a race or fails', async () => {
    m.save.mockRejectedValue(new Error('changed since you loaded it'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await maybeRecordLiveSince('a', now, prod)).toBe(false)
    spy.mockRestore()
  })
})

describe('pilotAllows', () => {
  it('everyone when no pilot is set, only the listed members otherwise', () => {
    expect(pilotAllows([], 'x')).toBe(true)
    expect(pilotAllows([], null)).toBe(true)
    expect(pilotAllows(['a', 'b'], 'a')).toBe(true)
    expect(pilotAllows(['a', 'b'], 'c')).toBe(false)
    expect(pilotAllows(['a'], null)).toBe(false)
    expect(pilotAllows(['a'], undefined)).toBe(false)
  })
})
