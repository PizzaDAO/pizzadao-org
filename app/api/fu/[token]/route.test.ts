import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.SESSION_SECRET = 'x'.repeat(40)
})
const perform = vi.fn()
vi.mock('@/app/lib/followups/link-actions', () => ({ performLinkAction: (...a: unknown[]) => perform(...a) }))
const notify = vi.fn()
vi.mock('@/app/lib/followups/notify', () => ({ notifyApprovers: (...a: unknown[]) => notify(...a) }))
const ipLimit = vi.fn()
const tokenLimit = vi.fn()
vi.mock('@/app/lib/rate-limit', () => ({
  checkRateLimit: (...a: unknown[]) => ipLimit(...a),
  checkKeyedRateLimit: (...a: unknown[]) => tokenLimit(...a),
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'slow' }), { status: 429 }),
}))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => void fn() }))

import * as route from './route'

const ctx = { params: Promise.resolve({ token: 'tok' }) }
const post = (body: unknown = {}, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/fu/tok', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

beforeEach(() => {
  vi.resetAllMocks()
  ipLimit.mockResolvedValue({ success: true })
  tokenLimit.mockResolvedValue({ success: true })
})

describe('POST /api/fu/[token]', () => {
  it('has no GET: opening the link can never change anything', () => {
    expect('GET' in route).toBe(false)
  })
  it('runs the action and reports the kind', async () => {
    perform.mockResolvedValue({ ok: true, kind: 'status', status: 'DONE' })
    const res = await route.POST(post(), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, kind: 'status' })
    expect(perform).toHaveBeenCalledWith('tok', { text: undefined, undo: false })
  })
  it('passes reply text and tells the approvers', async () => {
    notify.mockResolvedValue(1)
    perform.mockResolvedValue({ ok: true, kind: 'reply', status: 'REPLIED', notify: 'Reply from Member A' })
    expect((await route.POST(post({ text: 'hello' }), ctx)).status).toBe(200)
    expect(perform).toHaveBeenCalledWith('tok', { text: 'hello', undo: false })
    expect(notify).toHaveBeenCalledWith('Reply from Member A')
  })
  it('maps refusals to statuses', async () => {
    for (const [reason, status] of [['invalid', 404], ['expired', 404], ['not-found', 404], ['empty', 400], ['closed', 409]] as const) {
      perform.mockResolvedValue({ ok: false, reason })
      expect((await route.POST(post(), ctx)).status).toBe(status)
    }
  })
  it('is rate limited per IP and per token, before doing anything', async () => {
    ipLimit.mockResolvedValue({ success: false })
    expect((await route.POST(post(), ctx)).status).toBe(429)
    ipLimit.mockResolvedValue({ success: true })
    tokenLimit.mockResolvedValue({ success: false })
    expect((await route.POST(post(), ctx)).status).toBe(429)
    expect(perform).not.toHaveBeenCalled()
  })
  it('rejects a cross-origin or non-JSON write', async () => {
    expect((await route.POST(post({}, { origin: 'https://evil.example', host: 'localhost' }), ctx)).status).toBe(403)
    const form = new Request('http://localhost/api/fu/tok', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' })
    expect((await route.POST(form, ctx)).status).toBe(415)
    expect(perform).not.toHaveBeenCalled()
  })
  it('a crash is a generic 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    perform.mockRejectedValue(new Error('db down'))
    const res = await route.POST(post(), ctx)
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('db down')
  })
})
