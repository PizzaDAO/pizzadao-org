// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  dpr: true,
  save: (async (..._a: unknown[]) => ({}) as unknown) as (...a: unknown[]) => Promise<unknown>,
  audit: (async (..._a: unknown[]) => ({}) as unknown) as (...a: unknown[]) => Promise<unknown>,
}))

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: () => undefined }))
vi.mock('@/app/lib/session', () => ({ getSession: async () => ({ discordId: 'admin1' }) }))
vi.mock('@/app/lib/mission-review-access', () => ({ isDreadPizzaRoberts: async () => h.dpr }))
vi.mock('@/app/lib/db', () => ({ prisma: { appSettingChange: { create: (...a: unknown[]) => h.audit(...a) } } }))
vi.mock('@/app/lib/sheets/member-repository', () => ({
  fetchMemberById: async (id: string) => (id === 'm1' ? { discordId: 'd1' } : null),
}))
vi.mock('@/app/lib/wallet-lookup', () => ({ saveWalletForMember: (...a: unknown[]) => h.save(...a) }))
vi.mock('@/app/lib/mission-verify/events', () => ({ emitMissionEvent: async () => undefined }))
vi.mock('@/app/lib/events-attended/rsv', () => ({ refreshRsvEventsIfEnabled: async () => undefined }))

import { POST } from './route'

const ADDR = '0x1234567890123456789012345678901234567890'

function post(body: Record<string, unknown>) {
  return POST(
    new Request('https://app.pizzadao.org/api/admin/wallets', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'app.pizzadao.org' },
      body: JSON.stringify(body),
    })
  )
}

beforeEach(() => {
  h.dpr = true
  h.save = vi.fn(async () => ({ id: 9 }))
  h.audit = vi.fn(async () => ({}))
})

describe('POST /api/admin/wallets', () => {
  it('refuses anyone who is not Dread Pizza Roberts', async () => {
    h.dpr = false
    const res = await post({ memberId: 'm1', walletAddress: ADDR, note: 'custodial wallet' })
    expect(res.status).toBe(403)
    expect(h.save).not.toHaveBeenCalled()
    expect(h.audit).not.toHaveBeenCalled()
  })

  it('requires a note', async () => {
    const res = await post({ memberId: 'm1', walletAddress: ADDR, note: ' ' })
    expect(res.status).toBe(400)
    expect(h.save).not.toHaveBeenCalled()
  })

  it('404s an unknown member', async () => {
    const res = await post({ memberId: 'nope', walletAddress: ADDR, note: 'custodial wallet' })
    expect(res.status).toBe(404)
  })

  it('adds the wallet with source admin and writes an audit row with the note', async () => {
    const res = await post({ memberId: 'm1', walletAddress: ADDR, note: 'custodial wallet, lost key' })
    expect(res.status).toBe(200)
    expect(h.save).toHaveBeenCalledWith('m1', ADDR, 'admin', 'd1', 'evm', undefined)
    expect(h.audit).toHaveBeenCalledWith({
      data: expect.objectContaining({ key: 'wallet:m1:add', changedBy: 'admin1', note: 'custodial wallet, lost key' }),
    })
  })
})
