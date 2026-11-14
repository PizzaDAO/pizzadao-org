// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    attendanceSummary: { findUnique: vi.fn() },
    vouch: { count: vi.fn() },
    buddyPair: { findMany: vi.fn(), groupBy: vi.fn(), updateMany: vi.fn() },
    buddyProfile: { findMany: vi.fn(), updateMany: vi.fn() },
    buddyEvent: { findFirst: vi.fn(), create: vi.fn() },
  },
  memberId: vi.fn(),
}))
vi.mock('@/app/lib/db', () => ({ prisma: m.prisma }))
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: async () => true }))
vi.mock('@/app/lib/missions', () => ({ completedLevelBy: async () => new Set<string>(), getCurrentLevel: async () => 1 }))
vi.mock('@/app/lib/member-registration', () => ({ readSignedUpMembers: async () => new Map([['111111', 'Mario'], ['222222', 'Luigi'], ['333333', 'Peach']]) }))
vi.mock('@/app/lib/sheets/member-repository', () => ({ fetchMemberByDiscordId: async () => null, fetchMemberIdByDiscordId: m.memberId }))
vi.mock('./service', () => ({
  buddySettings: async () => ({ minLevel: 4, cap: 2, completionLevel: 2 }),
  completeIfDue: vi.fn(async () => false),
}))

import { getAdminOverview, loadChecklist } from './view'

beforeEach(() => {
  vi.clearAllMocks()
  m.prisma.buddyEvent.findFirst.mockResolvedValue(null)
  m.prisma.buddyEvent.create.mockResolvedValue({})
  m.prisma.attendanceSummary.findUnique.mockResolvedValue(null)
  m.prisma.vouch.count.mockResolvedValue(0)
  m.prisma.buddyPair.updateMany.mockResolvedValue({ count: 1 })
  m.prisma.buddyProfile.updateMany.mockResolvedValue({ count: 1 })
})

describe('getAdminOverview', () => {
  it('counts load and "has a buddy" from dedicated queries, not the newest-100 list', async () => {
    m.prisma.buddyProfile.findMany.mockResolvedValue([{ discordId: '222222', active: true, paused: false, maxActive: 2, addedBy: null }])
    m.prisma.buddyPair.findMany
      .mockResolvedValueOnce([]) // the (empty) recent list
      .mockResolvedValueOnce([{ traineeDiscordId: '111111' }]) // every active pair
    m.prisma.buddyPair.groupBy.mockResolvedValue([{ buddyDiscordId: '222222', _count: { _all: 2 } }])
    const o = await getAdminOverview()
    expect(o.buddies[0]).toMatchObject({ discordId: '222222', activeCount: 2, capacity: 2 })
    expect(o.trainees.map((t) => t.discordId)).toEqual(['333333']) // 111111 has a buddy, 222222 is a buddy
  })
})

describe('loadChecklist backfill', () => {
  const pair = { id: 'p1', introducedAt: null, traineeDiscordId: '111111', traineeMemberId: null, buddyDiscordId: '222222' }
  it('looks up and stores missing trainee and buddy member ids, then uses them for the vouch', async () => {
    m.memberId.mockImplementation(async (id: string) => (id === '111111' ? 'MT' : 'MB'))
    m.prisma.vouch.count.mockResolvedValue(1)
    await loadChecklist(pair, 1, 2, null)
    expect(m.prisma.buddyPair.updateMany).toHaveBeenCalledWith({ where: { id: 'p1', traineeMemberId: null }, data: { traineeMemberId: 'MT' } })
    expect(m.prisma.buddyProfile.updateMany).toHaveBeenCalledWith({ where: { discordId: '222222', memberId: null }, data: { memberId: 'MB' } })
    expect(m.prisma.vouch.count).toHaveBeenCalledWith({ where: { followerId: 'MB', followeeId: 'MT' } })
  })
  it('does not look anything up when the ids are present, and survives a failed lookup', async () => {
    await loadChecklist({ ...pair, traineeMemberId: 'MT' }, 1, 2, 'MB')
    expect(m.memberId).not.toHaveBeenCalled()
    m.memberId.mockRejectedValue(new Error('sheet down'))
    await expect(loadChecklist(pair, 1, 2, null)).resolves.toBeTruthy()
    expect(m.prisma.buddyPair.updateMany).not.toHaveBeenCalled()
  })
  it('remembers a member who is not in the sheet for a day, per pair and role', async () => {
    m.memberId.mockResolvedValue(null)
    m.prisma.buddyEvent.findFirst.mockResolvedValue(null)
    await loadChecklist(pair, 1, 2, null)
    expect(m.prisma.buddyEvent.create.mock.calls.map((c) => c[0].data.kind)).toEqual(['member_lookup_missed_trainee', 'member_lookup_missed_buddy'])
    m.memberId.mockClear()
    m.prisma.buddyEvent.findFirst.mockResolvedValue({ id: 'e1' }) // a miss from the last day
    await loadChecklist(pair, 1, 2, null)
    expect(m.memberId).not.toHaveBeenCalled()
  })
  it('does not cache a failed sheet read as "not found"', async () => {
    m.prisma.buddyEvent.findFirst.mockResolvedValue(null)
    m.memberId.mockRejectedValue(new Error('sheet down'))
    await loadChecklist(pair, 1, 2, null)
    expect(m.prisma.buddyEvent.create).not.toHaveBeenCalled()
  })
})
