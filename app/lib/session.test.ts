import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

let mod: typeof import('./session')

beforeAll(async () => {
  process.env.SESSION_SECRET = 'test-secret-at-least-32-chars-long!!'
  mod = await import('./session')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('verifySession', () => {
  it('accepts a freshly created token', () => {
    const token = mod.createSessionToken({ discordId: '123', createdAt: Date.now() })
    expect(mod.verifySession(token)?.discordId).toBe('123')
  })

  it('rejects a tampered token', () => {
    const token = mod.createSessionToken({ discordId: '123', createdAt: Date.now() })
    const [payload, sig] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ discordId: '999', createdAt: Date.now() })).toString('base64url')
    expect(mod.verifySession(`${forged}.${sig}`)).toBeNull()
    const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)
    expect(mod.verifySession(`${payload}.${flipped}`)).toBeNull()
  })

  it('rejects tokens older than the cookie maxAge', () => {
    const maxAgeMs = mod.SESSION_MAX_AGE_SECONDS * 1000
    const old = mod.createSessionToken({ discordId: '123', createdAt: Date.now() - maxAgeMs - 1000 })
    expect(mod.verifySession(old)).toBeNull()
    const almost = mod.createSessionToken({ discordId: '123', createdAt: Date.now() - maxAgeMs + 60_000 })
    expect(mod.verifySession(almost)?.discordId).toBe('123')
  })

  it('expires a token once time passes the maxAge', () => {
    const token = mod.createSessionToken({ discordId: '123', createdAt: Date.now() })
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + mod.SESSION_MAX_AGE_SECONDS * 1000 + 1000)
    expect(mod.verifySession(token)).toBeNull()
  })

  it('rejects tokens with missing or future createdAt', () => {
    const noCreated = mod.createSessionToken({ discordId: '123' } as never)
    expect(mod.verifySession(noCreated)).toBeNull()
    const future = mod.createSessionToken({ discordId: '123', createdAt: Date.now() + 60 * 60 * 1000 })
    expect(mod.verifySession(future)).toBeNull()
  })

  it('cookie maxAge matches the token lifetime', () => {
    expect(mod.getSessionCookieOptions().maxAge).toBe(mod.SESSION_MAX_AGE_SECONDS)
  })
})
