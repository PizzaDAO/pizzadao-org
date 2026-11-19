// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'

process.env.SESSION_SECRET = 'test-secret'

const h = vi.hoisted(() => ({ session: { discordId: 'd1' } as null | { discordId: string }, required: false }))

vi.mock('@/app/lib/session', () => ({ getSession: async () => h.session }))
vi.mock('@/app/lib/sheets/member-repository', () => ({
  fetchMemberById: async (id: string) => (id === 'm1' ? { discordId: 'd1' } : { discordId: 'other' }),
}))
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: async () => h.required }))
vi.mock('@/app/lib/rate-limit', () => ({
  checkKeyedRateLimit: async () => ({ success: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
}))

import { GET } from './route'
import { checkWalletNonce } from '@/app/lib/wallet-siwe'

const get = (q: string) => GET(new NextRequest(`https://app.pizzadao.org/api/wallet/nonce${q}`))

describe('GET /api/wallet/nonce', () => {
  it('needs a session', async () => {
    h.session = null
    expect((await get('?memberId=m1')).status).toBe(401)
    h.session = { discordId: 'd1' }
  })

  it("refuses another member's id", async () => {
    expect((await get('?memberId=m2')).status).toBe(403)
  })

  it('issues a nonce bound to the member, and reports the setting', async () => {
    h.required = true
    const body = await (await get('?memberId=m1')).json()
    expect(body.required).toBe(true)
    expect(checkWalletNonce(body.nonce, 'm1', 'd1')).toBe('ok')
    expect(checkWalletNonce(body.nonce, 'm1', 'someone-else')).toBe('bad')
    expect(body.expiresAt).toBeGreaterThan(Date.now())
  })
})
