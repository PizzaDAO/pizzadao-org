// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))
const apply = vi.fn()
vi.mock('@/app/lib/discord-activity', async (orig) => ({ ...(await orig<typeof import('@/app/lib/discord-activity')>()), applyActivityBatch: (...a: unknown[]) => apply(...a) }))
const getSetting = vi.fn()
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: (...a: unknown[]) => getSetting(...a) }))

import { POST } from './route'

const good = {
  batchId: 'batch-12345678',
  users: [{ discordId: '100000000000000001', firstAt: new Date(0).toISOString(), lastAt: new Date(0).toISOString(), days: { '1970-01-01': 1 }, channels: { general: 1 }, replies: 0, threads: 0 }],
}
const req = (body: unknown, auth?: string) =>
  new Request('http://x/api/calls/recorder/discord-activity', { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) })

describe('POST /api/calls/recorder/discord-activity', () => {
  beforeEach(() => {
    process.env.RECORDER_API_KEY = 'secret'
    apply.mockReset()
    apply.mockResolvedValue({ status: 'applied', users: 1 })
    getSetting.mockReset()
    getSetting.mockResolvedValue(true)
  })
  it('rejects a missing or wrong key before looking at the body', async () => {
    expect((await POST(req(good))).status).toBe(401)
    expect((await POST(req(good, 'Bearer nope'))).status).toBe(401)
    expect(apply).not.toHaveBeenCalled()
  })
  it('rejects a body that is not JSON or does not validate', async () => {
    expect((await POST(req('{nope', 'Bearer secret'))).status).toBe(400)
    expect((await POST(req({ ...good, users: [] }, 'Bearer secret'))).status).toBe(400)
    expect(apply).not.toHaveBeenCalled()
  })
  it('applies a batch with the key', async () => {
    const res = await POST(req(good, 'Bearer secret'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'applied', users: 1 })
    expect(apply).toHaveBeenCalledTimes(1)
  })
  it('answers 204 and applies nothing when counting is switched off', async () => {
    getSetting.mockResolvedValue(false)
    expect((await POST(req(good, 'Bearer secret'))).status).toBe(204)
    expect(apply).not.toHaveBeenCalled()
  })
})
