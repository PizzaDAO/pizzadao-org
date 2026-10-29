// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn(),
}))
vi.mock('@/app/lib/followups/telegram-updates', () => ({
  handleTelegramUpdate: vi.fn(async () => undefined),
  realUpdateDeps: vi.fn(() => ({})),
}))
vi.mock('@/app/lib/followups/notify', () => ({ notifyApprovers: vi.fn(async () => 0) }))
vi.mock('@/app/lib/followups/telegram', () => ({ answerCallback: vi.fn() }))

import { handleTelegramUpdate } from '@/app/lib/followups/telegram-updates'
import { secretMatches } from '@/app/lib/followups/webhook-auth'
import { POST } from './route'

const post = (headers: Record<string, string>, body: unknown = { update_id: 1, message: { message_id: 1, chat: { id: 5, type: 'private' }, text: 'hi' } }) =>
  new Request('https://app.pizzadao.org/api/telegram/webhook', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

let saved: string | undefined
beforeEach(() => {
  vi.clearAllMocks()
  saved = process.env.TELEGRAM_WEBHOOK_SECRET
  process.env.TELEGRAM_WEBHOOK_SECRET = 'hook-secret'
})
afterEach(() => {
  if (saved === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET
  else process.env.TELEGRAM_WEBHOOK_SECRET = saved
})

describe('POST /api/telegram/webhook auth', () => {
  it('503 and no work when no secret is configured (closed by default)', async () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET
    const res = await POST(post({ 'x-telegram-bot-api-secret-token': 'anything' }))
    expect(res.status).toBe(503)
    expect(handleTelegramUpdate).not.toHaveBeenCalled()
  })
  it('403 without the header', async () => {
    expect((await POST(post({}))).status).toBe(403)
    expect(handleTelegramUpdate).not.toHaveBeenCalled()
  })
  it('403 with a wrong secret, including one of the same length', async () => {
    expect((await POST(post({ 'x-telegram-bot-api-secret-token': 'wrong' }))).status).toBe(403)
    expect((await POST(post({ 'x-telegram-bot-api-secret-token': 'hook-secreX' }))).status).toBe(403)
    expect(handleTelegramUpdate).not.toHaveBeenCalled()
  })
  it('200 and handles the update with the right secret', async () => {
    const res = await POST(post({ 'x-telegram-bot-api-secret-token': 'hook-secret' }))
    expect(res.status).toBe(200)
    expect(handleTelegramUpdate).toHaveBeenCalledTimes(1)
  })
  it('still 200 when the handler throws (so Telegram does not retry forever)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(handleTelegramUpdate).mockRejectedValueOnce(new Error('boom'))
    expect((await POST(post({ 'x-telegram-bot-api-secret-token': 'hook-secret' }))).status).toBe(200)
  })
  it('400 for a body that is not JSON', async () => {
    const req = new Request('https://app.pizzadao.org/api/telegram/webhook', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'hook-secret' }, body: 'nope' })
    expect((await POST(req)).status).toBe(400)
  })
})

describe('secretMatches', () => {
  it('compares exactly', () => {
    expect(secretMatches('abc', 'abc')).toBe(true)
    expect(secretMatches('abd', 'abc')).toBe(false)
    expect(secretMatches('abcd', 'abc')).toBe(false)
    expect(secretMatches(null, 'abc')).toBe(false)
    expect(secretMatches('abc', undefined)).toBe(false)
    expect(secretMatches('', '')).toBe(false)
  })
})
