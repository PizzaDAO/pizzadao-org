// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const enforceRateLimit = vi.fn()
vi.mock('@/app/lib/rate-limit', () => ({ enforceRateLimit: (...a: unknown[]) => enforceRateLimit(...a) }))
vi.mock('@/app/lib/db', () => ({ prisma: {} }))

import { POST } from './route'

const req = () => new Request('https://x.test/api/city-timezone', { method: 'POST', body: JSON.stringify({ place_id: 'abc' }) })

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  enforceRateLimit.mockResolvedValue(null)
  process.env.GOOGLE_MAPS_API_KEY = 'k'
})

describe('POST /api/city-timezone', () => {
  it('is rate limited', async () => {
    enforceRateLimit.mockResolvedValue(new Response('{}', { status: 429 }))
    const res = await POST(req())
    expect(res.status).toBe(429)
    expect(enforceRateLimit).toHaveBeenCalledWith(expect.anything(), 'city-timezone')
  })

  it('sets a timeout on the Google fetch and hides upstream error text', async () => {
    const fetchMock = vi.fn(async () => ({ json: async () => ({ status: 'REQUEST_DENIED', error_message: 'upstream detail' }) }))
    vi.stubGlobal('fetch', fetchMock)
    const res = await POST(req())
    expect(res.status).toBe(502)
    const text = JSON.stringify(await res.json())
    expect(text).not.toContain('upstream detail')
    expect(text).not.toContain('REQUEST_DENIED')
    expect((fetchMock.mock.calls[0] as unknown[])[1]).toMatchObject({ signal: expect.anything() })
    vi.unstubAllGlobals()
  })
})
