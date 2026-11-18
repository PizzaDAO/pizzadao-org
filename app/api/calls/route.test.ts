// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const query = vi.fn()
vi.mock('@/app/lib/db', () => ({ prisma: { $queryRawUnsafe: (...a: unknown[]) => query(...a) } }))

import { GET } from './route'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  query.mockReset()
})

describe('GET /api/calls', () => {
  it('falls back to defaults for non-numeric page and limit', async () => {
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([])
    const res = await GET(new NextRequest('https://x.test/api/calls?page=abc&limit=xyz'))
    expect(res.status).toBe(200)
    expect((await res.json()).pagination).toMatchObject({ page: 1, limit: 20 })
  })

  it('answers a generic error when the query fails', async () => {
    query.mockRejectedValue(new Error('db internals'))
    const res = await GET(new NextRequest('https://x.test/api/calls'))
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('db internals')
  })
})
