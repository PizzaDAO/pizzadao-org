// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from 'jose'
import { buildLinkRedirect, checkState, makeState, verifyLinkToken, type LinkVerifyConfig } from './rsv-link'

const env = { SESSION_SECRET: 'sess' } as unknown as NodeJS.ProcessEnv
const HASH = 'b'.repeat(64)
const NOW = 1_800_000_000_000
const cfg: LinkVerifyConfig = { jwksUrl: 'https://api.rsv.example/.well-known/jwks.json', issuer: 'https://api.rsv.example', audience: 'pizzadao.org' }

describe('state', () => {
  it('is bound to the session discord id, expires, and fits the rsv.pizza format', () => {
    const s = makeState('d1', env, NOW)!
    expect(s).toMatch(/^[A-Za-z0-9._~-]{16,128}$/)
    expect(checkState(s, 'd1', env, NOW + 1000)).toBe(true)
    expect(checkState(s, 'd2', env, NOW + 1000)).toBe(false)
    expect(checkState(s, 'd1', env, NOW + 16 * 60 * 1000)).toBe(false)
    expect(checkState(s + 'x', 'd1', env, NOW)).toBe(false)
    expect(checkState('garbage', 'd1', env, NOW)).toBe(false)
  })
  it('needs a session secret', () => {
    expect(makeState('d1', {} as NodeJS.ProcessEnv)).toBeNull()
  })
})

async function setup() {
  const { publicKey, privateKey } = await generateKeyPair('ES256')
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' }
  const getKey = createLocalJWKSet({ keys: [jwk] })
  const nowSec = Math.floor(NOW / 1000)
  const mint = (over: { claims?: Record<string, unknown>; typ?: string; kid?: string; exp?: number; iat?: number; aud?: string; key?: CryptoKey } = {}) =>
    new SignJWT({ use: 'pizzadao_link', v: 1, email_sha256: HASH, state: 'STATE', ...over.claims })
      .setProtectedHeader({ alg: 'ES256', kid: over.kid ?? 'k1', typ: over.typ ?? 'pizzadao-link+jwt' })
      .setIssuer('https://api.rsv.example')
      .setAudience(over.aud ?? 'pizzadao.org')
      .setIssuedAt(over.iat ?? nowSec)
      .setExpirationTime(over.exp ?? nowSec + 300)
      .setJti(over.claims && 'jti' in over.claims ? (over.claims.jti as string) : 'j1')
      .sign(over.key ?? privateKey)
  return { getKey, mint, now: new Date(NOW) }
}

describe('verifyLinkToken', () => {
  it('accepts a good token and returns only the hash and jti', async () => {
    const { getKey, mint, now } = await setup()
    expect(await verifyLinkToken(await mint(), 'STATE', cfg, { getKey, now })).toEqual({ ok: true, emailHash: HASH, jti: 'j1', expiresAt: new Date(NOW + 300_000) })
  })

  it('rejects a wrong state, typ, use, version, audience or issuer', async () => {
    const { getKey, mint, now } = await setup()
    const bad = async (t: string, c: LinkVerifyConfig = cfg) => (await verifyLinkToken(t, 'STATE', c, { getKey, now })).ok
    expect(await verifyLinkToken(await mint(), 'OTHER', cfg, { getKey, now })).toEqual({ ok: false, reason: 'invalid' })
    expect(await bad(await mint({ typ: 'JWT' }))).toBe(false)
    expect(await bad(await mint({ claims: { use: 'other' } }))).toBe(false)
    expect(await bad(await mint({ claims: { v: 2 } }))).toBe(false)
    expect(await bad(await mint(), { ...cfg, audience: 'elsewhere' })).toBe(false)
    expect(await bad(await mint(), { ...cfg, issuer: 'https://evil' })).toBe(false)
  })

  it('rejects an MCP-shaped token (has a sub and another audience), and any token with a sub', async () => {
    const { getKey, mint, now } = await setup()
    expect((await verifyLinkToken(await mint({ claims: { sub: 'rsvpizza:123', use: 'mcp' }, aud: 'mcp.rsv.pizza' }), 'STATE', cfg, { getKey, now })).ok).toBe(false)
    expect((await verifyLinkToken(await mint({ claims: { sub: 'rsvpizza:123' } }), 'STATE', cfg, { getKey, now })).ok).toBe(false)
  })

  it('rejects a token issued in the future', async () => {
    const { getKey, mint, now } = await setup()
    const nowSec = Math.floor(NOW / 1000)
    expect((await verifyLinkToken(await mint({ iat: nowSec + 120, exp: nowSec + 180 }), 'STATE', cfg, { getKey, now })).ok).toBe(false)
    // within the 30 s clock tolerance is fine
    expect((await verifyLinkToken(await mint({ iat: nowSec + 20, exp: nowSec + 320 }), 'STATE', cfg, { getKey, now })).ok).toBe(true)
  })

  it('rejects a lifetime over 300 seconds', async () => {
    const { getKey, mint, now } = await setup()
    const nowSec = Math.floor(NOW / 1000)
    expect((await verifyLinkToken(await mint({ exp: nowSec + 301 }), 'STATE', cfg, { getKey, now })).ok).toBe(false)
  })

  it('rejects a token without a jti', async () => {
    const { getKey, mint, now } = await setup()
    expect((await verifyLinkToken(await mint({ claims: { jti: '' } }), 'STATE', cfg, { getKey, now })).ok).toBe(false)
  })

  it('rejects a malformed hash (an address, say)', async () => {
    const { getKey, mint, now } = await setup()
    expect((await verifyLinkToken(await mint({ claims: { email_sha256: 'a@b.co' } }), 'STATE', cfg, { getKey, now })).ok).toBe(false)
  })

  it('reports an expired token', async () => {
    const { getKey, mint, now } = await setup()
    expect(await verifyLinkToken(await mint({ iat: Math.floor(NOW / 1000) - 250, exp: Math.floor(NOW / 1000) - 40 }), 'STATE', cfg, { getKey, now })).toEqual({ ok: false, reason: 'expired' })
  })

  it('rejects a token signed by another key, an unknown kid, or a non-ES256 algorithm', async () => {
    const { getKey, mint, now } = await setup()
    const other = await generateKeyPair('ES256')
    expect((await verifyLinkToken(await mint({ key: other.privateKey }), 'STATE', cfg, { getKey, now })).ok).toBe(false)
    expect((await verifyLinkToken(await mint({ kid: 'nope' }), 'STATE', cfg, { getKey, now })).ok).toBe(false)
    const rsa = await generateKeyPair('RS256')
    const t = await new SignJWT({ use: 'pizzadao_link', v: 1, email_sha256: HASH, state: 'STATE' })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1', typ: 'pizzadao-link+jwt' }).setIssuer(cfg.issuer).setAudience(cfg.audience).setExpirationTime(Math.floor(NOW / 1000) + 300).sign(rsa.privateKey)
    expect((await verifyLinkToken(t, 'STATE', cfg, { getKey, now })).ok).toBe(false)
    expect((await verifyLinkToken('garbage', 'STATE', cfg, { getKey, now })).ok).toBe(false)
  })

  it('is unavailable (not invalid) when the key set cannot be fetched', async () => {
    const { mint, now } = await setup()
    const getKey = (async () => { throw new TypeError('fetch failed') }) as never
    expect(await verifyLinkToken(await mint(), 'STATE', cfg, { getKey, now })).toEqual({ ok: false, reason: 'unavailable' })
  })
})

describe('buildLinkRedirect', () => {
  it('adds return and state, and refuses non-https', () => {
    const u = new URL(buildLinkRedirect('https://rsv.pizza/link/pizzadao', 'ST', 'https://app/cb')!)
    expect(u.searchParams.get('state')).toBe('ST')
    expect(u.searchParams.get('return')).toBe('https://app/cb')
    expect(buildLinkRedirect('http://rsv.pizza/link', 'S', 'c')).toBeNull()
    expect(buildLinkRedirect('nope', 'S', 'c')).toBeNull()
  })
})
