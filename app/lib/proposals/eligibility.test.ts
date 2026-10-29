// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))
vi.mock('@/app/lib/rare-pizza-box', () => ({ checkRarePizzaBox: vi.fn() }))
vi.mock('@/app/lib/sheets/member-repository', () => ({ fetchMemberById: vi.fn() }))

import { snapshotEligibleVoters, type SnapshotDeps } from './eligibility'

const deps = (o: Partial<SnapshotDeps> & { holders?: string[]; failing?: string[] }): SnapshotDeps => ({
  candidates: async () => [
    { memberId: 'm1', discordId: '111111111111111111' },
    { memberId: 'm1', discordId: '111111111111111111' }, // second wallet of the same member
    { memberId: 'm2', discordId: null },
    { memberId: 'm3', discordId: '333333333333333333' },
    { memberId: 'm4', discordId: '444444444444444444' },
  ],
  resolveDiscordId: async (m) => (m === 'm2' ? '222222222222222222' : null),
  holdsBox: async (m) => (o.failing?.includes(m) ? 'error' : o.holders?.includes(m) ? 'yes' : 'no'),
  ...o,
})

describe('eligibility snapshot', () => {
  it('lists box holders once each, resolving the Discord id when the wallet row has none', async () => {
    const s = await snapshotEligibleVoters(deps({ holders: ['m1', 'm2', 'm3'] }))
    expect(s.discordIds).toEqual(['111111111111111111', '222222222222222222', '333333333333333333'])
    expect(s.errors).toBe(0)
  })

  it('checks each member once however many wallets they have', async () => {
    const holdsBox = vi.fn(async () => 'no' as const)
    await snapshotEligibleVoters(deps({ holdsBox }))
    expect(holdsBox).toHaveBeenCalledTimes(4)
  })

  it('fails closed: a failed lookup excludes the member and is counted', async () => {
    const s = await snapshotEligibleVoters(deps({ holders: ['m1'], failing: ['m3'] }))
    expect(s.discordIds).toEqual(['111111111111111111'])
    expect(s.errors).toBe(1)
  })

  it('skips a holder whose Discord id cannot be found', async () => {
    const s = await snapshotEligibleVoters(deps({ holders: ['m2'], resolveDiscordId: async () => null }))
    expect(s.discordIds).toEqual([])
  })
})
