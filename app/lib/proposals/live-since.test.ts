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
import { pilotAllows, pilotStateFrom } from './pilot-state'

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
    expect(await maybeRecordLiveSince('admin1', now, prod)).toBe('recorded')
    expect(m.save).toHaveBeenCalledWith('proposals.liveSince', '2026-12-01T18:00:00.000Z', 'admin1', expect.objectContaining({ expectedUpdatedAt: null }))
  })

  it('treats an empty saved value as unset and overwrites it', async () => {
    m.set.add('proposals.liveSince')
    expect(await maybeRecordLiveSince('a', now, prod)).toBe('recorded')
    expect(m.save.mock.calls[0][3]).not.toHaveProperty('expectedUpdatedAt')
  })

  it('does not record while a pilot runs, while the switch is off, on previews, or when already set', async () => {
    m.settings['proposals.pilotDiscordIds'] = ['100000000000000001']
    expect(await maybeRecordLiveSince('a', now, prod)).toBe('skipped')
    m.settings['proposals.pilotDiscordIds'] = []
    m.settings['proposals.enabled'] = false
    expect(await maybeRecordLiveSince('a', now, prod)).toBe('skipped')
    m.settings['proposals.enabled'] = true
    expect(await maybeRecordLiveSince('a', now, { VERCEL_ENV: 'preview' } as unknown as NodeJS.ProcessEnv)).toBe('skipped')
    expect(await maybeRecordLiveSince('a', now, { ...prod, PROPOSALS_ENABLED: '0' } as unknown as NodeJS.ProcessEnv)).toBe('skipped')
    m.settings['proposals.liveSince'] = '2026-11-30T00:00:00Z'
    m.set.add('proposals.liveSince')
    expect(await maybeRecordLiveSince('a', now, prod)).toBe('skipped')
    expect(m.save).not.toHaveBeenCalled()
  })

  it('reports an error (and logs) on a read failure or a failed save, never throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    m.readFailed = true
    expect(await maybeRecordLiveSince('a', now, prod)).toBe('error')
    m.readFailed = false
    m.save.mockRejectedValue(new Error('changed since you loaded it'))
    expect(await maybeRecordLiveSince('a', now, prod)).toBe('error')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('pilotStateFrom and pilotAllows', () => {
  const st = (over: Record<string, unknown>, extra: Partial<{ readFailed: boolean; invalidKeys: string[] }> = {}) =>
    pilotStateFrom({ readFailed: false, invalidKeys: [], ...extra, get: ((k: string) => ({ 'proposals.pilotDiscordIds': [], 'proposals.liveSince': '', ...over })[k]) as never } as never)

  it('everyone when no pilot is set, only the listed members while it runs', () => {
    expect(pilotAllows(st({}), 'x')).toBe(true)
    expect(pilotAllows(st({}), null)).toBe(true)
    const run = st({ 'proposals.pilotDiscordIds': ['a', 'b'] })
    expect(run).toMatchObject({ running: true, unknown: false })
    expect(pilotAllows(run, 'a')).toBe(true)
    expect(pilotAllows(run, 'c')).toBe(false)
    expect(pilotAllows(run, null)).toBe(false)
  })

  it('once go-live is recorded a refilled tester list is ignored (payments gate on, nobody locked out)', () => {
    const over = st({ 'proposals.pilotDiscordIds': ['a'], 'proposals.liveSince': '2026-12-01T18:00:00Z' })
    expect(over.running).toBe(false)
    expect(pilotAllows(over, 'zzz')).toBe(true)
    // an empty string is "not live yet"
    expect(st({ 'proposals.pilotDiscordIds': ['a'], 'proposals.liveSince': '' }).running).toBe(true)
  })

  it('a recorded go-live wins even when the tester list is invalid (voters allowed, gate on)', () => {
    const s = st({ 'proposals.liveSince': '2026-12-01T18:00:00Z' }, { invalidKeys: ['proposals.pilotDiscordIds'] })
    expect(s).toEqual({ running: false, unknown: false, ids: [] })
    expect(pilotAllows(s, 'anyone')).toBe(true)
    // but not when liveSince itself is invalid, or the whole read failed
    expect(st({ 'proposals.liveSince': '2026-12-01T18:00:00Z' }, { invalidKeys: ['proposals.pilotDiscordIds', 'proposals.liveSince'] }).unknown).toBe(true)
    expect(st({ 'proposals.liveSince': '2026-12-01T18:00:00Z' }, { readFailed: true }).unknown).toBe(true)
  })

  it('an unreadable or invalid list counts as a pilot running with an unknown list: nobody is allowed', () => {
    for (const extra of [{ readFailed: true }, { invalidKeys: ['proposals.pilotDiscordIds'] }]) {
      const s = st({}, extra)
      expect(s).toMatchObject({ running: true, unknown: true })
      expect(pilotAllows(s, 'a')).toBe(false)
    }
  })
})
