/**
 * "Link your rsv.pizza account": the second way to match a member to rsv.pizza guests (next to the
 * verified profile email). The member signs in on rsv.pizza with their email there; rsv.pizza sends them
 * back with a short-lived ES256 token (`?rsv_link=<jws>&state=<state>`) that carries a sha256 of that
 * email (never the address). We verify it offline against rsv.pizza's JWKS and store only the hash.
 *
 * Contract (rsv.pizza side):
 *   header  { alg: ES256, kid, typ: 'pizzadao-link+jwt' }
 *   claims  iss, aud, iat, exp (+300 s), jti, use: 'pizzadao_link', v: 1, email_sha256, state
 * Issuer, audience and the JWKS URL come from DB settings (see config.ts).
 *
 * Two parts: the state (binds the round trip to the signed-in session, CSRF) and the token check.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { createRemoteJWKSet, jwtVerify, errors, type JWTVerifyGetKey } from 'jose'

export const LINK_STATE_MAX_AGE_S = 15 * 60
export const LINK_STATE_COOKIE = 'rsv_link_state'
export const LINK_TOKEN_TYP = 'pizzadao-link+jwt'
export const LINK_TOKEN_USE = 'pizzadao_link'
export const LINK_TOKEN_MAX_LIFETIME_S = 300
const HASH_RE = /^[0-9a-f]{64}$/

type Env = NodeJS.ProcessEnv

function sessionSecret(env: Env): string | null {
  return env.SESSION_SECRET?.trim() || null
}

function mac(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url')
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * A fresh state tied to this Discord id: `<unixSeconds>.<random>.<mac>` (about 70 chars, all within
 * rsv.pizza's accepted `[A-Za-z0-9._~-]{16,128}`).
 */
export function makeState(discordId: string, env: Env = process.env, nowMs: number = Date.now()): string | null {
  const secret = sessionSecret(env)
  if (!secret) return null
  const body = `${Math.floor(nowMs / 1000)}.${randomBytes(12).toString('base64url')}`
  return `${body}.${mac(secret, `rsvlink:${discordId}:${body}`)}`
}

/** Constant-time equality for the state in the URL and the one in the cookie. */
export function statesMatch(a: string, b: string): boolean {
  return a.length > 0 && safeEqual(a, b)
}

/** True only for an unexpired state that this session's Discord id minted. */
export function checkState(state: string, discordId: string, env: Env = process.env, nowMs: number = Date.now()): boolean {
  const secret = sessionSecret(env)
  const parts = state.split('.')
  if (!secret || parts.length !== 3) return false
  const [ts, rand, sig] = parts
  const issued = Number(ts)
  if (!Number.isInteger(issued)) return false
  const age = nowMs / 1000 - issued
  if (age < -30 || age > LINK_STATE_MAX_AGE_S) return false
  return safeEqual(sig, mac(secret, `rsvlink:${discordId}:${ts}.${rand}`))
}

export type LinkVerifyResult = { ok: true; emailHash: string; jti: string; expiresAt: Date } | { ok: false; reason: 'invalid' | 'expired' | 'unavailable' }

export interface LinkVerifyConfig {
  jwksUrl: string
  issuer: string
  audience: string
}

// One remote key set per URL: jose caches the keys (5 minutes) and refetches on an unknown kid.
const keySets = new Map<string, JWTVerifyGetKey>()
function keySetFor(url: string): JWTVerifyGetKey {
  let k = keySets.get(url)
  if (!k) {
    k = createRemoteJWKSet(new URL(url), { cacheMaxAge: 5 * 60_000, cooldownDuration: 30_000, timeoutDuration: 4_000 })
    keySets.set(url, k)
  }
  return k
}

/**
 * Verify the token: ES256 only, typ, iss, aud, exp, `use`, no `sub`, exp - iat <= 300, a jti, `state` equal
 * to the expected one (constant time), and a well-formed `email_sha256`. Single use of the jti is the
 * caller's job (see the callback). `getKey` is injectable for tests.
 */
export async function verifyLinkToken(
  token: string,
  expectedState: string,
  cfg: LinkVerifyConfig,
  opts: { getKey?: JWTVerifyGetKey; now?: Date } = {},
): Promise<LinkVerifyResult> {
  if (!token || token.length > 4000) return { ok: false, reason: 'invalid' }
  try {
    const getKey = opts.getKey ?? keySetFor(cfg.jwksUrl)
    const { payload } = await jwtVerify(token, getKey, {
      algorithms: ['ES256'],
      typ: LINK_TOKEN_TYP,
      issuer: cfg.issuer,
      audience: cfg.audience,
      ...(opts.now ? { currentDate: opts.now } : {}),
    })
    if (payload.use !== LINK_TOKEN_USE || payload.v !== 1) return { ok: false, reason: 'invalid' }
    // An MCP token carries a `sub`; the link token never does (stops that token being replayed here).
    if (payload.sub !== undefined) return { ok: false, reason: 'invalid' }
    if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number' || payload.exp - payload.iat > LINK_TOKEN_MAX_LIFETIME_S) return { ok: false, reason: 'invalid' }
    if (typeof payload.jti !== 'string' || !payload.jti || payload.jti.length > 200) return { ok: false, reason: 'invalid' }
    if (typeof payload.state !== 'string' || !safeEqual(payload.state, expectedState)) return { ok: false, reason: 'invalid' }
    const eh = payload.email_sha256
    if (typeof eh !== 'string' || !HASH_RE.test(eh)) return { ok: false, reason: 'invalid' }
    return { ok: true, emailHash: eh, jti: payload.jti, expiresAt: new Date(payload.exp * 1000) }
  } catch (err) {
    if (err instanceof errors.JWTExpired) return { ok: false, reason: 'expired' }
    // Keys that cannot be fetched (timeout, network) are our problem, not the member's token.
    if (err instanceof errors.JWKSTimeout || !(err instanceof errors.JOSEError)) return { ok: false, reason: 'unavailable' }
    return { ok: false, reason: 'invalid' }
  }
}

/** Where to send the member: the configured link page plus our callback and state. */
export function buildLinkRedirect(linkUrl: string, state: string, callbackUrl: string): string | null {
  try {
    const u = new URL(linkUrl)
    if (u.protocol !== 'https:') return null
    u.searchParams.set('return', callbackUrl)
    u.searchParams.set('state', state)
    return u.toString()
  } catch {
    return null
  }
}
