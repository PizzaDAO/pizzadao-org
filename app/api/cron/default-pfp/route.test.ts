// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const settings: Record<string, unknown> = {
  'defaultPfp.assignEnabled': false,
  'defaultPfp.minYesVotes': 1,
  'defaultPfp.votedDownMargin': 1,
  'defaultPfp.recentActiveDays': 60,
  'defaultPfp.assignPerRun': 500,
  'defaultPfp.generatePerRun': 10,
  'defaultPfp.generateDailyMax': 50,
  'defaultPfp.generateMonthlyBudgetUsd': 25,
  'defaultPfp.generateCostCents': 10,
}
vi.mock('@/app/lib/settings', () => ({ getSetting: vi.fn(async (k: string) => settings[k]) }))
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: vi.fn(async (k: string) => settings[k]) }))
const dbTouched = vi.fn()
vi.mock('@/app/lib/db', () => ({ prisma: new Proxy({}, { get: () => { dbTouched(); throw new Error('db must not be used') } }) }))
vi.mock('@vercel/blob', () => ({ put: vi.fn() }))

import { GET } from './route'

const req = (auth?: string) => new NextRequest('https://app.pizzadao.org/api/cron/default-pfp', { headers: auth ? { authorization: auth } : {} })

beforeEach(() => {
  process.env.CRON_SECRET = 'cron-secret'
  settings['defaultPfp.assignEnabled'] = false
  dbTouched.mockClear()
})
afterEach(() => {
  delete process.env.CRON_SECRET
})

describe('GET /api/cron/default-pfp', () => {
  it('rejects a missing or wrong secret', async () => {
    expect((await GET(req())).status).toBe(401)
    expect((await GET(req('Bearer nope'))).status).toBe(401)
  })

  it('is a no-op while the toggle is off (no database use, no generation)', async () => {
    const res = await GET(req('Bearer cron-secret'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ skipped: 'disabled', generated: 0 })
    expect(dbTouched).not.toHaveBeenCalled()
  })
})
