// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const toggles: Record<string, boolean> = {}
const toggleEnabled = vi.fn(async (k: string) => !!toggles[k])
const runCalls = vi.fn(async (): Promise<unknown> => ({ skipped: 'disabled' }))
const listProposalPrefs = vi.fn(async () => [])
const clearSettled = vi.fn(async () => 0)
const loadSettings = vi.fn(async () => ({ get: (k: string) => ({ 'reminders.maxSendsPerRun': 40, 'reminders.proposalClosingHours': 24, 'reminders.maxPerMemberPerDay': 6 })[k] }))
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: (k: string) => toggleEnabled(k) }))
vi.mock('@/app/lib/settings', () => ({ loadSettings: () => loadSettings() }))
vi.mock('@/app/lib/proposals/constants', () => ({ proposalsEnabled: vi.fn(async () => true) }))
vi.mock('@/app/lib/proposals/pilot', () => ({ loadPilotState: vi.fn(async () => ({ running: false, unknown: false, ids: [] })) }))
vi.mock('./run', () => ({ runCallRemindersNow: () => runCalls() }))
vi.mock('./proposal-store', () => ({
  prismaProposalStore: { listProposalPrefs: () => listProposalPrefs() },
  clearSettledProposalReminders: () => clearSettled(),
}))
vi.mock('./store', () => ({ prismaStore: {}, MAX_ATTEMPTS: 3 }))

import { runRemindersNow } from './cron'

const PROD = { VERCEL_ENV: 'production', DISCORD_BOT_TOKEN: 'x' }

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of Object.keys(toggles)) delete toggles[k]
})

describe('runRemindersNow', () => {
  it('a preview does nothing: no settings, no proposal reads, no sweep', async () => {
    const r = await runRemindersNow(new Date(), { VERCEL_ENV: 'preview', DISCORD_BOT_TOKEN: 'x' })
    expect(r.proposals).toEqual({ skipped: 'disabled' })
    expect(loadSettings).not.toHaveBeenCalled()
    expect(listProposalPrefs).not.toHaveBeenCalled()
    expect(clearSettled).not.toHaveBeenCalled()
  })

  it('proposals switch off: skipped without reads, but the privacy sweep still runs in production', async () => {
    const r = await runRemindersNow(new Date(), PROD)
    expect(r.proposals).toEqual({ skipped: 'disabled' })
    expect(listProposalPrefs).not.toHaveBeenCalled()
    expect(clearSettled).toHaveBeenCalledTimes(1)
  })

  it('switch on: proposals run after calls, and calls are not blocked by them', async () => {
    toggles['reminders.proposalsEnabled'] = true
    const order: string[] = []
    runCalls.mockImplementation(async () => {
      order.push('calls')
      return { dryRun: false, sent: 3, stoppedEarly: false }
    })
    listProposalPrefs.mockImplementation(async () => {
      order.push('proposals')
      return []
    })
    const r = await runRemindersNow(new Date(), PROD)
    expect(order).toEqual(['calls', 'proposals'])
    expect(r.proposals).toMatchObject({ dryRun: false, sent: 0 })
  })

  it('shares the per-run cap: nothing left after calls means proposals wait', async () => {
    toggles['reminders.proposalsEnabled'] = true
    runCalls.mockResolvedValue({ dryRun: false, sent: 40, stoppedEarly: false })
    expect((await runRemindersNow(new Date(), PROD)).proposals).toEqual({ skipped: 'budget' })
    runCalls.mockResolvedValue({ dryRun: false, sent: 5, stoppedEarly: true })
    expect((await runRemindersNow(new Date(), PROD)).proposals).toEqual({ skipped: 'calls_first' })
    expect(listProposalPrefs).not.toHaveBeenCalled()
  })
})
