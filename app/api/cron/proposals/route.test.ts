// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({ enabled: true, run: vi.fn() }))
vi.mock('@/app/lib/proposals/constants', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/proposals/constants')>()),
  proposalsEnabled: async () => m.enabled,
}))
vi.mock('@/app/lib/proposals/lifecycle', () => ({ runProposalsCron: m.run }))

import { GET } from './route'

const req = (auth?: string) => new NextRequest('https://app.pizzadao.org/api/cron/proposals', { headers: auth ? { authorization: auth } : {} })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'cron-secret'
  m.enabled = true
  m.run.mockResolvedValue({ opened: 0, settled: 1, openPosts: 0, resultPosts: 1 })
})

describe('GET /api/cron/proposals', () => {
  it('rejects callers without the cron secret', async () => {
    expect((await GET(req())).status).toBe(401)
    expect((await GET(req('Bearer wrong'))).status).toBe(401)
    expect(m.run).not.toHaveBeenCalled()
  })

  it('does nothing while proposals are off', async () => {
    m.enabled = false
    expect(await (await GET(req('Bearer cron-secret'))).json()).toEqual({ skipped: 'disabled' })
    expect(m.run).not.toHaveBeenCalled()
  })

  it('runs the daily close', async () => {
    const r = await GET(req('Bearer cron-secret'))
    expect(await r.json()).toMatchObject({ settled: 1, resultPosts: 1 })
  })
})
