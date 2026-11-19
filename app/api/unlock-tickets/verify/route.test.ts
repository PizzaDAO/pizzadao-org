// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

const h = vi.hoisted(() => ({ save: vi.fn(), scan: vi.fn(async (..._a: unknown[]) => ({})) }))

vi.mock('@/app/lib/session', () => ({ getSession: async () => ({ discordId: 'd1', unlockWallet: '0x1234567890123456789012345678901234567890' }) }))
vi.mock('@/app/lib/sheets/member-repository', () => ({ fetchMemberIdByDiscordId: async () => 'm1' }))
vi.mock('@/app/lib/wallet-lookup', () => ({ saveWalletForMember: (...a: unknown[]) => h.save(...a) }))
vi.mock('@/app/lib/unlock/scan', () => ({
  scanMembers: (...a: unknown[]) => h.scan(...a),
  getTicketSummary: async () => ({ totalTickets: 2, events: [] }),
}))

import { GET } from './route'

describe('GET /api/unlock-tickets/verify', () => {
  it('scans only the saved wallets and never adds a wallet', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(h.save).not.toHaveBeenCalled()
    expect(h.scan).toHaveBeenCalledWith(['m1'])
  })
})
