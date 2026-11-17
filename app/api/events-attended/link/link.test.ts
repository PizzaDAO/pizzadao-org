// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  cfg: { enabled: true, rsvLinkUrl: 'https://rsv.pizza/link/pizzadao', rsvJwksUrl: 'https://api.rsv.example/j', rsvLinkIssuer: 'iss', rsvLinkAudience: 'aud' },
  verify: vi.fn(),
  refresh: vi.fn(async () => undefined),
  clear: vi.fn(async () => undefined),
  upsert: vi.fn(async () => ({})),
  updateMany: vi.fn(async () => ({ count: 1 })),
  jtiCreate: vi.fn(async () => ({})),
  jtiDelete: vi.fn(async () => ({ count: 0 })),
}))
const sess = vi.hoisted(() => ({ s: { discordId: 'd1' } as { discordId: string } | null }))
vi.mock('@/app/lib/auth-guards', () => ({ requireSession: vi.fn(async () => ({ ok: true, session: { discordId: 'd1' } })) }))
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn(async () => sess.s) }))
vi.mock('@/app/lib/db', () => ({ prisma: { memberProfileExtras: { upsert: h.upsert, updateMany: h.updateMany }, rsvLinkJti: { create: h.jtiCreate, deleteMany: h.jtiDelete } } }))
vi.mock('@/app/lib/member-utils', () => ({ findMemberIdByDiscordId: vi.fn(async () => '42') }))
vi.mock('@/app/lib/events-attended/config', () => ({ loadEventsAttendedConfig: vi.fn(async () => h.cfg) }))
vi.mock('@/app/lib/events-attended/rsv', () => ({ clearEmailMatches: h.clear, refreshRsvEventsIfEnabled: h.refresh }))
vi.mock('@/app/lib/events-attended/rsv-link', async (orig) => ({ ...(await orig<typeof import('@/app/lib/events-attended/rsv-link')>()), verifyLinkToken: h.verify }))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => void fn() }))

import { GET as start } from './start/route'
import { GET as callback } from './callback/route'
import { DELETE } from './route'
import { checkState } from '@/app/lib/events-attended/rsv-link'

const HASH = 'd'.repeat(64)
beforeEach(() => {
  vi.clearAllMocks()
  process.env.SESSION_SECRET = 'sess'
  h.cfg = { ...h.cfg, enabled: true }
  h.verify.mockResolvedValue({ ok: true, emailHash: HASH, jti: 'j', expiresAt: new Date(Date.now() + 60_000) })
  sess.s = { discordId: 'd1' }
})

async function begin() {
  const res = await start(new NextRequest('https://app.test/api/events-attended/link/start'))
  const target = new URL(res.headers.get('location')!)
  const state = target.searchParams.get('state')!
  return { res, target, state }
}
const cb = (qs: string, cookie?: string) =>
  new NextRequest(`https://app.test/api/events-attended/link/callback?${qs}`, cookie ? { headers: { cookie: `rsv_link_state=${encodeURIComponent(cookie)}` } } : undefined)

describe('link start', () => {
  it('redirects to rsv.pizza with a session-bound state, also set as an httpOnly cookie', async () => {
    const { res, target, state } = await begin()
    expect(res.status).toBe(303)
    expect(target.origin + target.pathname).toBe('https://rsv.pizza/link/pizzadao')
    expect(target.searchParams.get('return')).toBe('https://app.test/api/events-attended/link/callback')
    expect(checkState(state, 'd1')).toBe(true)
    expect(res.headers.get('set-cookie')).toMatch(/rsv_link_state=.*HttpOnly/i)
  })
  it('is not found while the feature is off', async () => {
    h.cfg.enabled = false
    expect((await start(new NextRequest('https://app.test/api/events-attended/link/start'))).status).toBe(404)
  })
})

describe('link callback', () => {
  it('stores only the hash, clears email matches and re-checks on success', async () => {
    const { state } = await begin()
    const res = await callback(cb(`state=${encodeURIComponent(state)}&rsv_link=tok`, state))
    expect(res.headers.get('location')).toContain('/profile/42?rsv=linked')
    expect(h.verify).toHaveBeenCalledWith('tok', state, { jwksUrl: 'https://api.rsv.example/j', issuer: 'iss', audience: 'aud' })
    expect(h.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ rsvLinkedEmailHash: HASH }) }))
    expect(h.clear).toHaveBeenCalledWith('42')
    expect(h.refresh).toHaveBeenCalledWith('42')
  })
  it('sends no-referrer, drops the token from the URL and clears the state cookie', async () => {
    const { state } = await begin()
    const res = await callback(cb(`state=${encodeURIComponent(state)}&rsv_link=tok`, state))
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    expect(res.headers.get('location')).not.toContain('rsv_link')
    expect(res.headers.get('location')).not.toContain('state=')
    expect(res.headers.get('set-cookie')).toMatch(/rsv_link_state=;/)
  })
  it('refuses a replayed token (the jti was already used)', async () => {
    h.jtiCreate.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }))
    const { state } = await begin()
    expect((await callback(cb(`state=${encodeURIComponent(state)}&rsv_link=tok`, state))).headers.get('location')).toContain('rsv=failed')
    expect(h.upsert).not.toHaveBeenCalled()
  })
  it('sends a signed-out visitor home rather than erroring on a URL with the token', async () => {
    sess.s = null
    const res = await callback(cb('state=x&rsv_link=tok', 'x'))
    expect(res.status).toBe(303)
    expect(new URL(res.headers.get('location')!).pathname).toBe('/')
    expect(h.verify).not.toHaveBeenCalled()
  })
  it('refuses a state that does not match the cookie (CSRF), or has no cookie', async () => {
    const { state } = await begin()
    const other = (await begin()).state
    for (const req of [cb(`state=${encodeURIComponent(state)}&rsv_link=tok`, other), cb(`state=${encodeURIComponent(state)}&rsv_link=tok`)]) {
      expect((await callback(req)).headers.get('location')).toContain('rsv=failed')
    }
    expect(h.upsert).not.toHaveBeenCalled()
  })
  it('refuses a state minted for another session', async () => {
    const forged = 'x.y.z'
    expect((await callback(cb(`state=${forged}&rsv_link=tok`, forged))).headers.get('location')).toContain('rsv=failed')
    expect(h.verify).not.toHaveBeenCalled()
  })
  it('stores nothing when the token does not verify', async () => {
    h.verify.mockResolvedValue({ ok: false, reason: 'invalid' })
    const { state } = await begin()
    expect((await callback(cb(`state=${encodeURIComponent(state)}&rsv_link=bad`, state))).headers.get('location')).toContain('rsv=failed')
    expect(h.upsert).not.toHaveBeenCalled()
    expect(h.refresh).not.toHaveBeenCalled()
  })
})

describe('unlink', () => {
  it('removes the hash, drops email matches and re-fetches', async () => {
    const res = await DELETE(new Request('https://app.test/api/events-attended/link', { method: 'DELETE' }))
    expect(await res.json()).toEqual({ linked: false })
    expect(h.updateMany).toHaveBeenCalledWith({ where: { memberId: '42' }, data: { rsvLinkedEmailHash: null, rsvLinkedAt: null } })
    expect(h.clear).toHaveBeenCalledWith('42')
    expect(h.refresh).toHaveBeenCalledWith('42')
  })
  it('rejects a cross-origin request', async () => {
    const res = await DELETE(new Request('https://app.test/api/events-attended/link', { method: 'DELETE', headers: { origin: 'https://evil.test', host: 'app.test' } }))
    expect(res.status).toBe(403)
    expect(h.updateMany).not.toHaveBeenCalled()
  })
})
