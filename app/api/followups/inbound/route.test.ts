import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const handle = vi.fn()
vi.mock('@/app/lib/followups/inbound', () => ({ handleInbound: (...a: unknown[]) => handle(...a) }))
const notify = vi.fn()
vi.mock('@/app/lib/followups/notify', () => ({ notifyApprovers: (...a: unknown[]) => notify(...a) }))
const limit = vi.fn()
vi.mock('@/app/lib/rate-limit', () => ({
  checkKeyedRateLimit: (...a: unknown[]) => limit(...a),
  rateLimitResponse: () => new Response('{}', { status: 429 }),
}))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => void fn() }))

import { POST } from './route'

const post = (body: unknown, key: string | null = 'tg-key') =>
  new Request('http://localhost/api/followups/inbound', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('VERCEL_ENV', 'production')
  vi.stubEnv('FOLLOWUP_INBOUND_TELEGRAM_KEY', 'tg-key')
  vi.stubEnv('RECORDER_API_KEY', 'rec-key')
  limit.mockResolvedValue({ success: true })
  notify.mockResolvedValue(1)
})
afterEach(() => vi.unstubAllEnvs())

describe('POST /api/followups/inbound', () => {
  it('answers 503 outside production, before looking at anything', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect((await POST(post({ senderId: '1', text: 'hi' }))).status).toBe(503)
    expect(handle).not.toHaveBeenCalled()
  })
  it('401 without or with a wrong key', async () => {
    expect((await POST(post({ senderId: '1', text: 'hi' }, null))).status).toBe(401)
    expect((await POST(post({ senderId: '1', text: 'hi' }, 'bad'))).status).toBe(401)
    expect(handle).not.toHaveBeenCalled()
  })
  it('validates the body', async () => {
    for (const body of [null, {}, { senderId: 'abc', text: 'x' }, { senderId: '1', text: 'x'.repeat(4001) }, { senderId: '1', kind: 'video' }, { senderId: '1', text: 'x', externalKey: 'k'.repeat(121) }, { senderId: 5, text: 'x' }]) {
      expect((await POST(post(body))).status).toBe(400)
    }
    expect(handle).not.toHaveBeenCalled()
  })
  it('the key decides the source and the approvers are alerted', async () => {
    handle.mockResolvedValue({ claimed: true, ack: 'Got it', notify: 'Reply from X' })
    const res = await POST(post({ senderId: '1', text: 'hi', externalKey: 'k1', source: 'discord' }))
    expect(await res.json()).toEqual({ claimed: true, ack: 'Got it' })
    expect(handle).toHaveBeenCalledWith({ source: 'telegram', senderId: '1', text: 'hi', kind: 'text', externalKey: 'k1' })
    expect(notify).toHaveBeenCalledWith('Reply from X')
    handle.mockResolvedValue({ claimed: false })
    await POST(post({ senderId: '1', text: 'hi' }, 'rec-key'))
    expect(handle).toHaveBeenLastCalledWith(expect.objectContaining({ source: 'discord' }))
  })
  it('429 when rate limited; 500 when handling fails', async () => {
    limit.mockResolvedValue({ success: false })
    expect((await POST(post({ senderId: '1', text: 'hi' }))).status).toBe(429)
    limit.mockResolvedValue({ success: true })
    handle.mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await POST(post({ senderId: '1', text: 'hi' }))).status).toBe(500)
  })
})
