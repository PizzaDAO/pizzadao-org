// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db', () => ({
  prisma: {
    paymentRequest: { count: vi.fn(async () => 2), findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    memberWallet: { findMany: vi.fn(async () => [{ walletAddress: '0xabc' }]) },
    telegramAccount: { findUnique: vi.fn(async () => null) },
  },
}))
vi.mock('@/app/lib/missions', () => ({ getCurrentLevel: vi.fn(async () => 5) }))
vi.mock('./rsv-track', async (orig) => ({
  ...(await orig<typeof import('./rsv-track')>()),
  rsvConfig: vi.fn(() => ({ baseUrl: 'https://x.test', serviceKey: 'k' })),
  fetchRsvTrack: vi.fn(async () => ({ tier: 'fast_pass', rawTier: 'fast_pass', eligibleForFastPass: true, verifiedParties: 3 })),
}))

import { fetchRsvTrack } from './rsv-track'
import { __clearRsvCache, cachedRsv, hostViewFor, trustFor } from './trust-load'
import { snowflakeAt } from '@/app/lib/mission-verify/policy'
import { policy } from './test-utils'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const ID = snowflakeAt(new Date('2025-01-01T00:00:00Z'), 1)
const on = policy({ fastTrackEnabled: true })

beforeEach(() => {
  vi.clearAllMocks()
  __clearRsvCache()
})

describe('party-platform lookups', () => {
  it('a member page load never calls the party platform when nothing is cached', async () => {
    const view = await hostViewFor(ID, on)
    expect(fetchRsvTrack).not.toHaveBeenCalled()
    expect(view.paid).toBe(2)
  })

  it('a check run asks once and caches the answer; later page loads use the cache without a call', async () => {
    await trustFor(ID, on)
    expect(fetchRsvTrack).toHaveBeenCalledTimes(1)
    expect(cachedRsv(ID)?.eligibleForFastPass).toBe(true)
    m(fetchRsvTrack).mockClear()
    const view = await hostViewFor(ID, policy({ fastTrackEnabled: true, fastTrackMinPaidRequests: 20 }))
    expect(fetchRsvTrack).not.toHaveBeenCalled()
    expect(view.state).toBe('ready') // the cached Fast Pass stands in for the paid-request history
  })

  it('a failed lookup is cached as "none" too, so a slow platform is not hammered', async () => {
    m(fetchRsvTrack).mockResolvedValueOnce(null)
    await trustFor(ID, on)
    expect(cachedRsv(ID)).toBeNull()
    expect(cachedRsv(ID, Date.now() + 11 * 60_000)).toBeUndefined()
  })
})
