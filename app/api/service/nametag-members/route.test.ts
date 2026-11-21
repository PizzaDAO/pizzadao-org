import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const settings: Record<string, number> = {}
vi.mock('@/app/lib/settings', () => ({ getSetting: async (k: string) => settings[k] }))
const limit = vi.fn()
vi.mock('@/app/lib/rate-limit', () => ({
  checkKeyedRateLimit: (...a: unknown[]) => limit(...a),
  rateLimitResponse: () => new Response('{}', { status: 429 }),
}))
const match = vi.fn()
vi.mock('@/app/lib/nametags/match', async (orig) => ({ ...(await orig<typeof import('@/app/lib/nametags/match')>()), matchIdentifiers: (...a: unknown[]) => match(...a) }))
const cards = vi.fn()
vi.mock('@/app/lib/nametags/card', () => ({
  composeNametagCards: (...a: unknown[]) => cards(...a),
  loadNametagFields: async () => ({ city: true, crews: true, level: true, maxCrews: 2 }),
}))

import { POST } from './route'

const H1 = 'a'.repeat(64)
const W1 = '0x' + '1'.repeat(40)
const post = (body: unknown, key: string | null = 'svc-key') =>
  new Request('http://localhost/api/service/nametag-members', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('NAMETAG_SERVICE_KEY', 'svc-key')
  Object.assign(settings, { 'nametags.enabled': 1, 'nametags.matchWallets': 1, 'nametags.maxIdentifiers': 10 })
  limit.mockResolvedValue({ success: true })
  match.mockResolvedValue([])
  cards.mockResolvedValue(new Map())
})
afterEach(() => vi.unstubAllEnvs())

describe('POST /api/service/nametag-members', () => {
  it('503 when no key is configured (fails closed)', async () => {
    vi.stubEnv('NAMETAG_SERVICE_KEY', '')
    expect((await POST(post({ emailHashes: [H1] }))).status).toBe(503)
    expect(match).not.toHaveBeenCalled()
  })
  it('401 with a missing or wrong key', async () => {
    expect((await POST(post({ emailHashes: [H1] }, null))).status).toBe(401)
    expect((await POST(post({ emailHashes: [H1] }, 'nope'))).status).toBe(401)
    expect(match).not.toHaveBeenCalled()
  })
  it('503 disabled while the setting is off', async () => {
    settings['nametags.enabled'] = 0
    const r = await POST(post({ emailHashes: [H1] }))
    expect(r.status).toBe(503)
    expect((await r.json()).error).toBe('disabled')
    expect(match).not.toHaveBeenCalled()
  })
  it('429 when rate limited', async () => {
    limit.mockResolvedValue({ success: false })
    expect((await POST(post({ emailHashes: [H1] }))).status).toBe(429)
  })
  it('400 on a bad body: not hex, bad wallet, nothing to look up, not json', async () => {
    expect((await POST(post({ emailHashes: ['not-a-hash'] }))).status).toBe(400)
    expect((await POST(post({ wallets: ['0x12'] }))).status).toBe(400)
    expect((await POST(post({}))).status).toBe(400)
    const bad = new Request('http://localhost/x', { method: 'POST', headers: { Authorization: 'Bearer svc-key' }, body: 'nope' })
    expect((await POST(bad)).status).toBe(400)
  })
  it('413 past the identifier cap setting', async () => {
    const many = Array.from({ length: 11 }, (_, i) => String(i).padStart(64, '0'))
    expect((await POST(post({ emailHashes: many }))).status).toBe(413)
    expect(match).not.toHaveBeenCalled()
  })
  it('passes the wallet setting through to the matcher', async () => {
    settings['nametags.matchWallets'] = 0
    await POST(post({ emailHashes: [H1], wallets: [W1] }))
    expect(match).toHaveBeenCalledWith({ emailHashes: [H1], wallets: [W1] }, { matchWallets: false })
  })
  it('returns matches with no-store, skipping members without a card', async () => {
    match.mockResolvedValue([
      { memberId: '7', emailHash: H1 },
      { memberId: '8', wallet: W1 },
    ])
    cards.mockResolvedValue(new Map([['7', { memberId: '7', name: 'Pat', pfpUrl: 'https://x/y.png' }]]))
    const r = await POST(post({ emailHashes: [H1], wallets: [W1] }))
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('private, no-store')
    expect(await r.json()).toEqual({ ok: true, matches: [{ emailHash: H1, member: { memberId: '7', name: 'Pat', pfpUrl: 'https://x/y.png' } }] })
  })
  it('500 (no identifiers logged) when matching throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    match.mockRejectedValue(new Error('db down'))
    expect((await POST(post({ emailHashes: [H1] }))).status).toBe(500)
    expect(JSON.stringify(spy.mock.calls)).not.toContain(H1)
    spy.mockRestore()
  })
})
