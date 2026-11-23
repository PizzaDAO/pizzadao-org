// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))
const lookup = vi.fn()
const redeem = vi.fn()
vi.mock('@/app/lib/redemption-codes', async (orig) => ({
  ...(await orig<typeof import('@/app/lib/redemption-codes')>()),
  lookupCode: (...a: unknown[]) => lookup(...a),
  redeemCode: (...a: unknown[]) => redeem(...a),
}))

import { POST as LOOKUP } from './lookup/route'
import { POST as REDEEM } from './redeem/route'
import { isProofOfPizzaAuthorized } from '@/app/lib/proof-of-pizza-auth'
import { __resetMemoryRateLimits } from '@/app/lib/rate-limit'

const req = (path: string, body: unknown, auth?: string, ip = '9.9.9.9') =>
  new Request(`http://x/api/proof-of-pizza/codes/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...(auth ? { authorization: auth } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

beforeEach(() => {
  process.env.PROOF_OF_PIZZA_API_KEY = 'secret-key'
  delete process.env.KV_REST_API_URL
  __resetMemoryRateLimits()
  lookup.mockReset()
  redeem.mockReset()
})

describe('auth', () => {
  it('compares the bearer key exactly', () => {
    const env = { PROOF_OF_PIZZA_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv
    expect(isProofOfPizzaAuthorized('Bearer k', env)).toBe(true)
    expect(isProofOfPizzaAuthorized('Bearer k ', env)).toBe(true)
    for (const bad of ['Bearer kk', 'Bearer', 'k', 'bearer k', '', null, undefined]) expect(isProofOfPizzaAuthorized(bad, env)).toBe(false)
    expect(isProofOfPizzaAuthorized('Bearer ', { PROOF_OF_PIZZA_API_KEY: '' } as unknown as NodeJS.ProcessEnv)).toBe(false)
  })
})

describe.each([
  ['lookup', LOOKUP, { code: 'AB23' }],
  ['redeem', REDEEM, { code: 'AB23', ref: 'sub1' }],
] as const)('POST %s', (name, POST, good) => {
  it('refuses everything (503) when no key is configured, even with a header', async () => {
    delete process.env.PROOF_OF_PIZZA_API_KEY
    expect((await POST(req(name, good, 'Bearer secret-key'))).status).toBe(503)
    expect((await POST(req(name, good, 'Bearer '))).status).toBe(503)
    expect(lookup).not.toHaveBeenCalled()
    expect(redeem).not.toHaveBeenCalled()
  })

  it('rejects a missing or wrong key before reading the body or the database', async () => {
    expect((await POST(req(name, good))).status).toBe(401)
    expect((await POST(req(name, good, 'Bearer nope'))).status).toBe(401)
    expect(lookup).not.toHaveBeenCalled()
    expect(redeem).not.toHaveBeenCalled()
  })

  it('answers 400 to a malformed code without a database call', async () => {
    for (const body of [{ code: 'AB0C', ref: 'x' }, { code: 'ABC', ref: 'x' }, {}, 'not json']) {
      expect((await POST(req(name, body as never, 'Bearer secret-key'))).status).toBe(400)
    }
    expect(lookup).not.toHaveBeenCalled()
    expect(redeem).not.toHaveBeenCalled()
  })

  it('rate limits wrong keys per IP (429), and stops answering that IP', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 12; i++) statuses.push((await POST(req(name, good, 'Bearer nope', '8.8.8.8'))).status)
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true)
    expect(statuses[11]).toBe(429)
    // another IP is unaffected
    expect((await POST(req(name, good, 'Bearer nope', '7.7.7.7'))).status).toBe(401)
  })

  it('rate limits every call per IP before the key is checked', async () => {
    let last = 0
    for (let i = 0; i < 61; i++) last = (await POST(req(name, '{}', 'Bearer secret-key', '6.6.6.6'))).status
    expect(last).toBe(429)
  })
})

describe('lookup', () => {
  it('normalizes the code and returns the lookup result', async () => {
    lookup.mockResolvedValue({ status: 'active', holderName: 'Someone', acquiredAt: '2026-01-01T00:00:00.000Z' })
    const res = await LOOKUP(req('lookup', { code: ' ab-23 ' }, 'Bearer secret-key'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'active', holderName: 'Someone', acquiredAt: '2026-01-01T00:00:00.000Z' })
    expect(lookup).toHaveBeenCalledWith('AB23')
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
})

describe('redeem', () => {
  const call = () => REDEEM(req('redeem', { code: 'ab23', ref: 'sub1' }, 'Bearer secret-key'))
  it('200 on redeemed and on the same ref again', async () => {
    redeem.mockResolvedValueOnce({ status: 'redeemed', redeemedAt: 'T' })
    expect(await (await call()).json()).toEqual({ ok: true, already: false, redeemedAt: 'T' })
    expect(redeem).toHaveBeenCalledWith('AB23', 'proofofpizza:sub1')
    redeem.mockResolvedValueOnce({ status: 'already', redeemedAt: 'T' })
    expect(await (await call()).json()).toEqual({ ok: true, already: true, redeemedAt: 'T' })
  })
  it('409 for a different submission, 404 for unknown or void', async () => {
    redeem.mockResolvedValueOnce({ status: 'conflict' })
    const c = await call()
    expect(c.status).toBe(409)
    expect(await c.json()).toEqual({ error: 'already_redeemed' })
    redeem.mockResolvedValueOnce({ status: 'not_found' })
    const n = await call()
    expect(n.status).toBe(404)
    expect(await n.json()).toEqual({ error: 'unknown_or_void' })
  })
  it('400 without a usable ref', async () => {
    expect((await REDEEM(req('redeem', { code: 'AB23' }, 'Bearer secret-key'))).status).toBe(400)
    expect((await REDEEM(req('redeem', { code: 'AB23', ref: 'a b' }, 'Bearer secret-key'))).status).toBe(400)
  })
})
