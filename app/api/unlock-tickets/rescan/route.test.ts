// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const scanMembers = vi.fn(async () => ({ failedChains: [] as number[] }))
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn(async () => ({ discordId: 'd1' })) }))
vi.mock('@/app/lib/db', () => ({ prisma: { unlockScanState: { findUnique: vi.fn(async () => null) } } }))
vi.mock('@/app/lib/settings', () => ({ getSetting: vi.fn(async () => 10) }))
vi.mock('@/app/lib/sheets/member-repository', () => ({ fetchMemberIdByDiscordId: vi.fn(async () => 'm1') }))
vi.mock('@/app/lib/unlock/scan', () => ({
  getTicketSummary: vi.fn(async () => ({ totalTickets: 0, events: [], wallets: 1, lastScanAt: null })),
  rescanWaitSeconds: vi.fn(() => 0),
  scanMembers: () => scanMembers(),
}))

import { POST } from './route'

const req = (headers: Record<string, string>) => new Request('http://localhost/api/unlock-tickets/rescan', { method: 'POST', headers, body: '{}' })

beforeEach(() => scanMembers.mockClear())

describe('POST /api/unlock-tickets/rescan', () => {
  it('rejects non-JSON and cross-origin writes without scanning', async () => {
    expect((await POST(req({}))).status).toBe(415)
    expect((await POST(req({ 'content-type': 'application/json', origin: 'https://evil.example', host: 'pizzadao.test' }))).status).toBe(403)
    expect(scanMembers).not.toHaveBeenCalled()
  })
  it('scans for a same-origin JSON request', async () => {
    const res = await POST(req({ 'content-type': 'application/json', origin: 'https://pizzadao.test', host: 'pizzadao.test' }))
    expect(res.status).toBe(200)
    expect(scanMembers).toHaveBeenCalledTimes(1)
  })
})
