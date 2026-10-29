// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/app/lib/db')

import { prisma } from '@/app/lib/db'
import { clearSettingsCache } from '@/app/lib/settings'
import { DEFAULT_DISAVOW_RULES, loadDisavowRules } from './rules'

const findMany = vi.mocked(prisma.appSetting.findMany)
const rows = (o: Record<string, unknown>) => findMany.mockResolvedValue(Object.entries(o).map(([key, value]) => ({ key, value })) as never)

beforeEach(() => {
  clearSettingsCache({ all: true })
  findMany.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('loadDisavowRules', () => {
  it('with no rows the rules are exactly today\'s constants', async () => {
    findMany.mockResolvedValue([])
    expect(await loadDisavowRules()).toEqual(DEFAULT_DISAVOW_RULES)
    expect(DEFAULT_DISAVOW_RULES).toEqual({
      yesThreshold: 3, decisionDays: 7, windowDays: 14, nominationsPerWindow: 3, nominationWindowDays: 30, listingMonths: 12, appealCooldownDays: 90,
    })
  })

  it('reads saved values', async () => {
    rows({ 'disavow.yesThreshold': 4, 'disavow.listingMonths': 6, 'disavow.appealCooldownDays': 30 })
    expect(await loadDisavowRules()).toMatchObject({ yesThreshold: 4, listingMonths: 6, appealCooldownDays: 30, decisionDays: 7 })
  })

  it('keeps a round winnable if the window and decision days disagree in the database', async () => {
    rows({ 'disavow.decisionDays': 20, 'disavow.windowDays': 10 })
    const r = await loadDisavowRules()
    expect(r.windowDays).toBe(20)
  })

  it('settings unreadable: the code defaults (the reviewed values), never a throw', async () => {
    findMany.mockRejectedValue(new Error('db down'))
    expect(await loadDisavowRules()).toEqual(DEFAULT_DISAVOW_RULES)
  })

  it('an invalid stored value falls back to the default for that rule only', async () => {
    rows({ 'disavow.yesThreshold': 1, 'disavow.listingMonths': 6 })
    const r = await loadDisavowRules()
    expect(r.yesThreshold).toBe(3)
    expect(r.listingMonths).toBe(6)
  })
})
