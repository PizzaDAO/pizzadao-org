// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))
const handle = vi.fn()
vi.mock('@/app/lib/calls/live-state', async (orig) => ({ ...(await orig<typeof import('@/app/lib/calls/live-state')>()), handleLiveState: (...a: unknown[]) => handle(...a) }))

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: () => undefined }))
vi.mock('@/app/lib/calls/live-announce-command', () => ({ liveTickForSession: vi.fn() }))
const welcomeFor = vi.fn()
vi.mock('@/app/lib/calls/welcome', () => ({ welcomeForSessionId: (...a: unknown[]) => welcomeFor(...a) }))

import { POST } from './route'

const good = { sessionId: 's-1', startedAt: new Date(0).toISOString(), present: [] }
const req = (body: unknown, auth?: string) =>
  new Request('http://x/api/calls/recorder/live-state', { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) })

describe('POST /api/calls/recorder/live-state', () => {
  beforeEach(() => {
    process.env.RECORDER_API_KEY = 'secret'
    handle.mockReset()
    handle.mockResolvedValue('ok')
    welcomeFor.mockReset()
    welcomeFor.mockResolvedValue(null)
  })
  it('rejects a missing or wrong key before looking at the body', async () => {
    expect((await POST(req(good))).status).toBe(401)
    expect((await POST(req(good, 'Bearer nope'))).status).toBe(401)
    expect(handle).not.toHaveBeenCalled()
  })
  it('rejects a body that is not JSON or does not validate', async () => {
    expect((await POST(req('{nope', 'Bearer secret'))).status).toBe(400)
    expect((await POST(req({ ...good, sessionId: '' }, 'Bearer secret'))).status).toBe(400)
    expect(handle).not.toHaveBeenCalled()
  })
  it('stores a heartbeat with the key', async () => {
    const res = await POST(req(good, 'Bearer secret'))
    expect(res.status).toBe(200)
    expect(handle).toHaveBeenCalledTimes(1)
  })
  it('hands the call welcome to the recorder in the answer, and passes on a failed post', async () => {
    welcomeFor.mockResolvedValue({ content: 'Welcome!' })
    const res = await POST(req({ ...good, welcomeFailed: true }, 'Bearer secret'))
    expect(await res.json()).toEqual({ welcome: { content: 'Welcome!' } })
    expect(welcomeFor).toHaveBeenCalledWith('s-1', { failed: true })
  })
  it('answers an empty object when there is no welcome', async () => {
    expect(await (await POST(req(good, 'Bearer secret'))).json()).toEqual({})
  })
  it('answers 204 when the live view is off', async () => {
    handle.mockResolvedValue('off')
    expect((await POST(req(good, 'Bearer secret'))).status).toBe(204)
  })
})
