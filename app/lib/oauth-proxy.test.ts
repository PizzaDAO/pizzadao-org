// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  validateReturnTo,
  encodeOAuthState,
  decodeOAuthState,
  generateOAuthNonce,
  verifyOAuthNonce,
  readCookie,
  oauthStateCookieOptions,
  getProductionOrigin,
} from './oauth-proxy'

describe('validateReturnTo', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('accepts PizzaDAO preview deployments and production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(validateReturnTo('https://onboarding-abc123xyz-pizza-dao.vercel.app')).toBe(true)
    expect(validateReturnTo('https://onboarding-git-feature-x-pizza-dao.vercel.app/')).toBe(true)
    expect(validateReturnTo('https://onboarding-v7lj-abc123xyz-pizza-dao.vercel.app')).toBe(true)
    expect(validateReturnTo('https://app.pizzadao.org')).toBe(true)
  })

  it('rejects arbitrary vercel.app hosts and lookalikes', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(validateReturnTo('https://evil.vercel.app')).toBe(false)
    expect(validateReturnTo('https://evil-pizza-dao.vercel.app')).toBe(false)
    expect(validateReturnTo('https://onboarding-x.evil-pizza-dao.vercel.app')).toBe(false)
    expect(validateReturnTo('https://onboarding-abc-pizza-dao.vercel.app.evil.com')).toBe(false)
    expect(validateReturnTo('http://onboarding-abc-pizza-dao.vercel.app')).toBe(false)
    expect(validateReturnTo('https://pizzadao.org')).toBe(false)
    expect(validateReturnTo('https://evil.app.pizzadao.org')).toBe(false)
    expect(validateReturnTo('https://user@app.pizzadao.org')).toBe(false)
  })

  it('rejects paths, queries and garbage', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(validateReturnTo('https://app.pizzadao.org/dashboard')).toBe(false)
    expect(validateReturnTo('https://app.pizzadao.org/?x=1')).toBe(false)
    expect(validateReturnTo('javascript:alert(1)')).toBe(false)
    expect(validateReturnTo('')).toBe(false)
  })

  it('only allows localhost outside production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(validateReturnTo('http://localhost:3000')).toBe(false)
    vi.stubEnv('NODE_ENV', 'development')
    expect(validateReturnTo('http://localhost:3000')).toBe(true)
  })

  it('production origin is the app host, not the marketing apex', () => {
    expect(getProductionOrigin()).toBe('https://app.pizzadao.org')
  })
})

describe('OAuth state', () => {
  it('round-trips sessionId, return_to and nonce', () => {
    const nonce = generateOAuthNonce()
    const encoded = encodeOAuthState({
      sessionId: 'sess-1',
      return_to: 'https://onboarding-abc-pizza-dao.vercel.app',
      nonce,
    })
    expect(decodeOAuthState(encoded)).toEqual({
      sessionId: 'sess-1',
      return_to: 'https://onboarding-abc-pizza-dao.vercel.app',
      nonce,
    })
  })

  it('treats a legacy plain state as a sessionId with no nonce', () => {
    expect(decodeOAuthState('plain-session')).toEqual({ sessionId: 'plain-session' })
    expect(decodeOAuthState('')).toEqual({ sessionId: '' })
  })

  it('ignores non-string fields from a tampered state', () => {
    const tampered = Buffer.from(JSON.stringify({ sessionId: 's', nonce: 123, return_to: {} })).toString('base64url')
    expect(decodeOAuthState(tampered)).toEqual({ sessionId: 's', nonce: undefined, return_to: undefined })
  })

  it('generates unpredictable nonces', () => {
    const a = generateOAuthNonce()
    const b = generateOAuthNonce()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(32)
  })

  it('verifies the nonce against the cookie', () => {
    expect(verifyOAuthNonce('abc', 'abc')).toBe(true)
    expect(verifyOAuthNonce('abc', 'abd')).toBe(false)
    expect(verifyOAuthNonce('abc', 'abcd')).toBe(false)
    expect(verifyOAuthNonce(undefined, 'abc')).toBe(false)
    expect(verifyOAuthNonce('abc', undefined)).toBe(false)
    expect(verifyOAuthNonce('', '')).toBe(false)
  })

  it('reads cookies from the request', () => {
    const req = new Request('https://app.pizzadao.org/api/discord/callback', {
      headers: { cookie: 'a=1; oauth_state=xyz%3D; b=2' },
    })
    expect(readCookie(req, 'oauth_state')).toBe('xyz=')
    expect(readCookie(req, 'missing')).toBeUndefined()
  })

  it('uses a short-lived httpOnly, secure, lax cookie scoped to the Discord routes', () => {
    const opts = oauthStateCookieOptions(new Request('https://app.pizzadao.org/api/discord/login'))
    expect(opts).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/api/discord' })
    expect(opts.maxAge).toBeLessThanOrEqual(600)
  })
})
