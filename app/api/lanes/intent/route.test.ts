// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/rate-limit')>()),
  enforceRateLimit: vi.fn(async () => null),
}))
// admin-guard imports the DPR check, which this suite does not need.
vi.mock('@/app/lib/mission-review-access', () => ({ isDreadPizzaRoberts: vi.fn() }))
vi.mock('@/app/lib/auth-guards', () => ({ requireSession: vi.fn() }))
const lanesEnabled = vi.fn()
const getPublishedLane = vi.fn()
vi.mock('@/app/lib/lanes', () => ({
  lanesEnabled: () => lanesEnabled(),
  getPublishedLane: (...a: unknown[]) => getPublishedLane(...a),
}))

import { POST, DELETE } from './route'

const post = (body: unknown) =>
  new Request('https://app.test/api/lanes/intent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  lanesEnabled.mockResolvedValue(true)
  getPublishedLane.mockResolvedValue({ slug: 'host', tag: 'Host', title: 'Throw a party', steps: [] })
})

describe('POST /api/lanes/intent', () => {
  it('remembers a published lane in an httpOnly pd_lane cookie and returns its public name', async () => {
    const res = await POST(post({ slug: 'host' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, lane: { slug: 'host', tag: 'Host', title: 'Throw a party' } })
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(/^pd_lane=host;/)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/Path=\//)
    expect(cookie).toMatch(/Max-Age=259200/)
  })

  it('404 with no cookie while the setting is off', async () => {
    lanesEnabled.mockResolvedValue(false)
    const res = await POST(post({ slug: 'host' }))
    expect(res.status).toBe(404)
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(getPublishedLane).not.toHaveBeenCalled()
  })

  it('refuses bad slugs (400) and unknown or unpublished lanes (404), never setting a cookie', async () => {
    for (const body of [{ slug: '../x' }, { slug: 'Host' }, { slug: 5 }, {}, 'nope']) {
      const res = await POST(post(body))
      expect(res.status).toBe(400)
      expect(res.headers.get('set-cookie')).toBeNull()
    }
    getPublishedLane.mockResolvedValue(null)
    const res = await POST(post({ slug: 'draft' }))
    expect(res.status).toBe(404)
    expect(res.headers.get('set-cookie')).toBeNull()
    getPublishedLane.mockRejectedValue(new Error('db down'))
    expect((await POST(post({ slug: 'host' }))).status).toBe(404)
  })

  it('DELETE forgets the lane', async () => {
    const res = await DELETE(new Request('https://app.test/api/lanes/intent', { method: 'DELETE' }))
    expect(res.headers.get('set-cookie')).toMatch(/pd_lane=;.*Max-Age=0/i)
  })
  it('rejects non-JSON and cross-origin writes (POST and DELETE) before anything else runs', async () => {
    const noType = new Request('https://app.test/api/lanes/intent', { method: 'POST', body: '{"slug":"host"}' })
    expect((await POST(noType)).status).toBe(415)
    const cross = new Request('https://app.test/api/lanes/intent', { method: 'POST', headers: { 'content-type': 'application/json', host: 'app.test', origin: 'https://evil.test' }, body: '{"slug":"host"}' })
    const res = await POST(cross)
    expect(res.status).toBe(403)
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(lanesEnabled).not.toHaveBeenCalled()
    const crossDel = new Request('https://app.test/api/lanes/intent', { method: 'DELETE', headers: { host: 'app.test', origin: 'https://evil.test' } })
    expect((await DELETE(crossDel)).status).toBe(403)
  })
})
