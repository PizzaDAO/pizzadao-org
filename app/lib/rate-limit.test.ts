// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const upstashLimit = vi.fn()
vi.mock('@upstash/ratelimit', () => {
  class Ratelimit {
    static slidingWindow = vi.fn(() => 'sliding')
    limit = (id: string) => upstashLimit(id)
  }
  return { Ratelimit }
})
vi.mock('@upstash/redis', () => ({ Redis: class {} }))

import {
  getClientIp,
  checkRateLimit,
  enforceRateLimit,
  rateLimitResponse,
  memoryLimit,
  __resetMemoryRateLimits,
} from './rate-limit'

function req(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/x', { method: 'POST', headers })
}

describe('getClientIp', () => {
  it('uses the first x-forwarded-for value', () => {
    expect(getClientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }))).toBe('1.2.3.4')
  })
  it('falls back to x-real-ip', () => {
    expect(getClientIp(new Headers({ 'x-real-ip': '5.6.7.8' }))).toBe('5.6.7.8')
  })
  it('returns "unknown" when no header is present', () => {
    expect(getClientIp(new Headers())).toBe('unknown')
  })
})

describe('in-memory limiter', () => {
  const savedUrl = process.env.KV_REST_API_URL
  const savedToken = process.env.KV_REST_API_TOKEN
  beforeEach(() => {
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
    __resetMemoryRateLimits()
  })
  afterEach(() => {
    if (savedUrl) process.env.KV_REST_API_URL = savedUrl
    if (savedToken) process.env.KV_REST_API_TOKEN = savedToken
  })

  it('allows up to the limit then blocks with 429 + Retry-After', async () => {
    const r = req({ 'x-forwarded-for': '9.9.9.9' })
    for (let i = 0; i < 5; i++) {
      expect(await enforceRateLimit(r, 'suggestions')).toBeNull()
    }
    const blocked = await enforceRateLimit(r, 'suggestions')
    expect(blocked?.status).toBe(429)
    const retryAfter = Number(blocked?.headers.get('Retry-After'))
    expect(retryAfter).toBeGreaterThan(0)
    expect(retryAfter).toBeLessThanOrEqual(600)
  })

  it('keys by IP and by limit name', async () => {
    const a = req({ 'x-forwarded-for': '1.1.1.1' })
    const b = req({ 'x-forwarded-for': '2.2.2.2' })
    for (let i = 0; i < 5; i++) await checkRateLimit(a, 'suggestions')
    expect((await checkRateLimit(a, 'suggestions')).success).toBe(false)
    expect((await checkRateLimit(b, 'suggestions')).success).toBe(true)
    expect((await checkRateLimit(a, 'namegen')).success).toBe(true)
  })

  it('resets after the window passes', () => {
    const rule = { limit: 1, windowSec: 10 }
    const t0 = 1_000_000
    expect(memoryLimit('k', rule, t0).success).toBe(true)
    expect(memoryLimit('k', rule, t0 + 1000).success).toBe(false)
    expect(memoryLimit('k', rule, t0 + 10_001).success).toBe(true)
  })
})

describe('upstash backend', () => {
  beforeEach(() => {
    process.env.KV_REST_API_URL = 'https://example.upstash.io'
    process.env.KV_REST_API_TOKEN = 'tok'
    __resetMemoryRateLimits()
    upstashLimit.mockReset()
  })
  afterEach(() => {
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
  })

  it('uses Upstash with a hashed IP identifier', async () => {
    upstashLimit.mockResolvedValue({ success: false, limit: 5, remaining: 0, reset: Date.now() + 30_000 })
    const res = await enforceRateLimit(req({ 'x-forwarded-for': '3.3.3.3' }), 'suggestions')
    expect(res?.status).toBe(429)
    const id = upstashLimit.mock.calls[0][0] as string
    expect(id).not.toContain('3.3.3.3')
    expect(id).toMatch(/^[0-9a-f]{32}$/)
  })

  it('fails open when Redis errors', async () => {
    upstashLimit.mockRejectedValue(new Error('redis down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await enforceRateLimit(req(), 'namegen')).toBeNull()
    spy.mockRestore()
  })
})

describe('rateLimitResponse', () => {
  it('rounds Retry-After up to at least 1 second', () => {
    const now = 1_000_000
    const res = rateLimitResponse({ success: false, limit: 1, remaining: 0, reset: now + 1500 }, now)
    expect(res.headers.get('Retry-After')).toBe('2')
    const res2 = rateLimitResponse({ success: false, limit: 1, remaining: 0, reset: now - 10 }, now)
    expect(res2.headers.get('Retry-After')).toBe('1')
  })
})
