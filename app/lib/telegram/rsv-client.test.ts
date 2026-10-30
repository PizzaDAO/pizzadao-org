import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { probe, RSV_TELEGRAM_TIMEOUT_MS, sendDm, telegramSendAllowed, telegramSendsKilled } from './rsv-client'

const PROD = { VERCEL_ENV: 'production', RSV_PIZZA_TELEGRAM_KEY: 'secret-key', RSV_PIZZA_API_URL: 'https://api.example.test/' }
const json = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
const dm = { telegramUserId: '555', text: 'hi', idempotencyKey: 'fu:abcdefgh:1' }

describe('telegramSendAllowed', () => {
  it('needs production, the key, and no kill switch', () => {
    expect(telegramSendAllowed(PROD)).toBe(true)
    expect(telegramSendAllowed({ ...PROD, VERCEL_ENV: 'preview' })).toBe(false)
    expect(telegramSendAllowed({ ...PROD, VERCEL_ENV: undefined })).toBe(false)
    expect(telegramSendAllowed({ ...PROD, RSV_PIZZA_TELEGRAM_KEY: ' ' })).toBe(false)
    expect(telegramSendAllowed({ ...PROD, RSV_PIZZA_TELEGRAM_KEY: undefined })).toBe(false)
    for (const v of ['off', '0', 'false', 'no', 'OFF']) expect(telegramSendAllowed({ ...PROD, TELEGRAM_SENDS_ENABLED: v })).toBe(false)
    expect(telegramSendsKilled({ TELEGRAM_SENDS_ENABLED: 'on' })).toBe(false)
  })
})

describe('sendDm', () => {
  it('makes no network call when sending is not allowed (preview, no key, kill switch)', async () => {
    const fetchImpl = vi.fn()
    for (const env of [{ ...PROD, VERCEL_ENV: 'preview' }, { ...PROD, RSV_PIZZA_TELEGRAM_KEY: undefined }, { ...PROD, TELEGRAM_SENDS_ENABLED: 'off' }]) {
      expect(await sendDm(dm, { env, fetchImpl: fetchImpl as never })).toEqual({ ok: false, code: 'not_configured' })
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('posts to the proxy with the key header and returns the message id', async () => {
    const fetchImpl = json(200, { ok: true, messageId: 7 })
    const buttons = [[{ text: 'Done', url: 'https://app.pizzadao.org/fu/x' }]]
    expect(await sendDm({ ...dm, buttons }, { env: PROD, fetchImpl: fetchImpl as never })).toEqual({ ok: true, messageId: 7 })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.example.test/api/service/telegram/dm')
    expect((init.headers as Record<string, string>)['x-pizzadao-telegram-key']).toBe('secret-key')
    expect(JSON.parse(String(init.body))).toEqual({ ...dm, buttons })
  })

  it('passes a replayed result through', async () => {
    expect(await sendDm(dm, { env: PROD, fetchImpl: json(200, { ok: true, messageId: 7, replay: true }) as never })).toEqual({ ok: true, messageId: 7, replay: true })
  })

  it('maps the Telegram outcome codes', async () => {
    for (const code of ['not_started', 'blocked', 'bad_request', 'uncertain']) {
      expect(await sendDm(dm, { env: PROD, fetchImpl: json(200, { ok: false, code }) as never })).toEqual({ ok: false, code })
    }
    expect(await sendDm(dm, { env: PROD, fetchImpl: json(200, { ok: false, code: 'rate_limited', retryAfter: 12 }) as never })).toEqual({ ok: false, code: 'rate_limited', retryAfter: 12 })
  })

  it('treats an unknown code or a malformed 200 as uncertain', async () => {
    expect(await sendDm(dm, { env: PROD, fetchImpl: json(200, { ok: false, code: 'weird' }) as never })).toEqual({ ok: false, code: 'uncertain' })
    expect(await sendDm(dm, { env: PROD, fetchImpl: json(200, { hello: 1 }) as never })).toEqual({ ok: false, code: 'uncertain' })
  })

  it('reads the 503 reason: unavailable is transient, not a config problem', async () => {
    expect(await sendDm(dm, { env: PROD, fetchImpl: json(503, { ok: false, reason: 'unavailable' }) as never })).toEqual({ ok: false, code: 'unavailable' })
    expect(await sendDm(dm, { env: PROD, fetchImpl: json(503, { ok: false, reason: 'not configured' }) as never })).toEqual({ ok: false, code: 'not_configured' })
    expect(await sendDm(dm, { env: PROD, fetchImpl: json(503, { ok: false, reason: 'disabled' }) as never })).toEqual({ ok: false, code: 'not_configured' })
  })

  it('maps auth and validation errors', async () => {
    expect(await sendDm(dm, { env: PROD, fetchImpl: json(401, { ok: false }) as never })).toEqual({ ok: false, code: 'not_configured' })
    expect(await sendDm(dm, { env: PROD, fetchImpl: json(400, { ok: false }) as never })).toEqual({ ok: false, code: 'bad_request' })
    expect(await sendDm(dm, { env: PROD, fetchImpl: json(409, { ok: false }) as never })).toEqual({ ok: false, code: 'bad_request' })
  })

  it('a 5xx other than 503, a network error and a timeout are uncertain', async () => {
    expect(await sendDm(dm, { env: PROD, fetchImpl: json(500, {}) as never })).toEqual({ ok: false, code: 'uncertain' })
    expect(await sendDm(dm, { env: PROD, fetchImpl: vi.fn(async () => { throw new Error('boom') }) as never })).toEqual({ ok: false, code: 'uncertain' })
    vi.useFakeTimers()
    const hang = vi.fn((_u: string, init: RequestInit) => new Promise((_res, rej) => init.signal?.addEventListener('abort', () => rej(new Error('aborted')))))
    const pending = sendDm(dm, { env: PROD, fetchImpl: hang as never })
    await vi.advanceTimersByTimeAsync(RSV_TELEGRAM_TIMEOUT_MS + 1)
    expect(await pending).toEqual({ ok: false, code: 'uncertain' })
    vi.useRealTimers()
  })

  it('never puts the key in a result', async () => {
    const r = await sendDm(dm, { env: PROD, fetchImpl: json(401, { ok: false }) as never })
    expect(JSON.stringify(r)).not.toContain('secret-key')
  })
})

describe('probe', () => {
  it('is unreachable/not_configured without calling when sending is off', async () => {
    const fetchImpl = vi.fn()
    expect(await probe('555', { env: { ...PROD, VERCEL_ENV: 'preview' }, fetchImpl: fetchImpl as never })).toEqual({ reachable: false, code: 'not_configured' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('maps reachable and the failure codes', async () => {
    expect(await probe('555', { env: PROD, fetchImpl: json(200, { ok: true, reachable: true }) as never })).toEqual({ reachable: true })
    expect(await probe('555', { env: PROD, fetchImpl: json(200, { ok: true, reachable: false, code: 'not_started' }) as never })).toEqual({ reachable: false, code: 'not_started' })
    expect(await probe('555', { env: PROD, fetchImpl: json(200, { ok: true, reachable: false, code: 'rate_limited', retryAfter: 3 }) as never })).toEqual({ reachable: false, code: 'rate_limited', retryAfter: 3 })
    expect(await probe('555', { env: PROD, fetchImpl: json(503, { ok: false, reason: 'unavailable' }) as never })).toEqual({ reachable: false, code: 'unavailable' })
    expect(await probe('555', { env: PROD, fetchImpl: json(200, {}) as never })).toEqual({ reachable: false, code: 'uncertain' })
  })
})

describe('the no-token rule', () => {
  it('the client never talks to Telegram directly', () => {
    const src = readFileSync(join(process.cwd(), 'app/lib/telegram/rsv-client.ts'), 'utf8')
    expect(src).not.toContain('api.telegram.org')
    expect(src).not.toMatch(/setWebhook|deleteWebhook|getUpdates|setdomain/i)
  })
})
