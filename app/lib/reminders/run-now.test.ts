import { describe, expect, it, vi, beforeEach } from 'vitest'

const toggleEnabled = vi.fn(async () => true)
const loadSettings = vi.fn(async () => ({ get: () => 60 }))
const listCallPrefs = vi.fn(async () => [])
const fetchUpcomingEvents = vi.fn(async () => [])
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: () => toggleEnabled() }))
vi.mock('@/app/lib/settings', () => ({ loadSettings: () => loadSettings() }))
vi.mock('@/app/lib/call-agenda/run', () => ({ fetchUpcomingEvents: () => fetchUpcomingEvents() }))
vi.mock('@/app/lib/calls/post-filters', () => ({ loadPostFilter: vi.fn(async () => ({ excludedCrewIds: [], excludedCrewLabelTerms: [], blockedTerms: [] })) }))
vi.mock('./store', async (orig) => ({ ...(await orig<typeof import('./store')>()), prismaStore: { listCallPrefs: () => listCallPrefs() } }))

import { runCallRemindersNow } from './run'

const PROD = { VERCEL_ENV: 'production', DISCORD_BOT_TOKEN: 'x', DISCORD_GUILD_ID: 'g' }

beforeEach(() => {
  vi.clearAllMocks()
  toggleEnabled.mockResolvedValue(true)
})

describe('runCallRemindersNow when off', () => {
  it('a preview skips without reading settings, Discord or the database', async () => {
    expect(await runCallRemindersNow(new Date(), { VERCEL_ENV: 'preview', DISCORD_BOT_TOKEN: 'x' })).toEqual({ skipped: 'disabled' })
    expect(toggleEnabled).not.toHaveBeenCalled()
    expect(loadSettings).not.toHaveBeenCalled()
    expect(fetchUpcomingEvents).not.toHaveBeenCalled()
    expect(listCallPrefs).not.toHaveBeenCalled()
  })
  it('production with the switch off skips without Discord or database reads', async () => {
    toggleEnabled.mockResolvedValue(false)
    expect(await runCallRemindersNow(new Date(), PROD)).toEqual({ skipped: 'disabled' })
    expect(fetchUpcomingEvents).not.toHaveBeenCalled()
    expect(listCallPrefs).not.toHaveBeenCalled()
  })
  it('dryRun runs the counting path on demand, still a dry run even when the switch is on', async () => {
    const r = await runCallRemindersNow(new Date(), PROD, { dryRun: true })
    expect(r).toMatchObject({ dryRun: true, occurrences: 0, sent: 0 })
    expect(fetchUpcomingEvents).toHaveBeenCalled()
  })
})
