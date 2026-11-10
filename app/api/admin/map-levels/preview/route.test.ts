// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const requireDpr = vi.fn()
const compute = vi.fn()
vi.mock('@/app/lib/admin-guard', () => ({
  requireDpr: () => requireDpr(),
  json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
}))
vi.mock('@/app/lib/settings', () => ({ loadSettings: async () => ({}) }))
vi.mock('@/app/lib/map-levels/service', () => ({ computeAdminPreview: (...a: unknown[]) => compute(...a) }))

import { GET } from './route'

beforeEach(() => {
  requireDpr.mockReset()
  compute.mockReset()
})

describe('GET /api/admin/map-levels/preview', () => {
  it('is refused without the admin check, and computes nothing', async () => {
    requireDpr.mockResolvedValue({ ok: false, response: new Response('{}', { status: 403 }) })
    expect((await GET()).status).toBe(403)
    expect(compute).not.toHaveBeenCalled()
  })

  it('returns the preview for an admin', async () => {
    requireDpr.mockResolvedValue({ ok: true })
    compute.mockResolvedValue({ totals: { members: 1 } })
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).totals.members).toBe(1)
  })
})
