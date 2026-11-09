// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const scanAllMembers = vi.fn(async () => ({ members: 3, batches: 1, failedBatches: 0, created: 2, gone: 0, errors: [] }))
vi.mock('@/app/lib/unlock/scan', () => ({ scanAllMembers: () => scanAllMembers() }))

import { GET } from './route'

const req = (auth?: string) => new NextRequest('http://localhost/api/cron/unlock-tickets', { headers: auth ? { authorization: auth } : {} })

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', 'shh')
  scanAllMembers.mockClear()
})
afterEach(() => vi.unstubAllEnvs())

describe('GET /api/cron/unlock-tickets', () => {
  it('rejects without the bearer secret and scans nothing', async () => {
    expect((await GET(req())).status).toBe(401)
    expect((await GET(req('Bearer wrong'))).status).toBe(401)
    expect(scanAllMembers).not.toHaveBeenCalled()
  })

  it('fails closed when CRON_SECRET is unset', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await GET(req('Bearer '))).status).toBe(401)
  })

  it('runs the scan with the right secret', async () => {
    const res = await GET(req('Bearer shh'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ members: 3, created: 2 })
    expect(scanAllMembers).toHaveBeenCalledTimes(1)
  })

  it('returns an error (not a success) when the scan throws', async () => {
    scanAllMembers.mockRejectedValueOnce(new Error('db down'))
    expect((await GET(req('Bearer shh'))).status).toBe(500)
  })
})
