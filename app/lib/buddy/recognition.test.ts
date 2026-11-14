// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    buddyProfile: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    buddyPair: { count: vi.fn(), findFirst: vi.fn(), groupBy: vi.fn(), updateMany: vi.fn() },
  },
  on: { 'buddy.enabled': true, 'buddy.publicRecognitionEnabled': true } as Record<string, boolean>,
  names: {} as Record<string, string>,
}))
vi.mock('@/app/lib/db', () => ({ prisma: m.prisma }))
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: async (k: string) => m.on[k] }))
vi.mock('@/app/lib/settings', () => ({ loadSettings: async () => ({ get: () => 2 }) }))
vi.mock('@/app/lib/sheets/member-repository', () => ({
  fetchMemberByDiscordId: async (id: string) => (m.names[id] ? { memberId: 'x', name: m.names[id] } : null),
}))

import { getBuddyRecognition, getTopBuddies, rankBuddies, setRecognitionHidden } from './recognition'

beforeEach(() => {
  vi.clearAllMocks()
  m.on['buddy.enabled'] = true
  m.on['buddy.publicRecognitionEnabled'] = true
  m.names = { b1: 'Bea', b2: 'Bo', b3: 'Bix' }
  m.prisma.buddyProfile.findFirst.mockResolvedValue(null)
  m.prisma.buddyProfile.findUnique.mockResolvedValue(null)
  m.prisma.buddyPair.findFirst.mockResolvedValue(null)
  m.prisma.buddyPair.count.mockResolvedValue(0)
})

describe('getBuddyRecognition', () => {
  it('returns nothing while the toggle (or the base buddy system) is off, and reads nothing', async () => {
    m.on['buddy.publicRecognitionEnabled'] = false
    expect(await getBuddyRecognition('M1')).toBeNull()
    m.on['buddy.publicRecognitionEnabled'] = true
    m.on['buddy.enabled'] = false
    expect(await getBuddyRecognition('M1')).toBeNull()
    expect(m.prisma.buddyPair.count).not.toHaveBeenCalled()
  })
  it('a buddy shows "helped N" only from 1 completed pair, counting COMPLETED only, and not when opted out', async () => {
    m.prisma.buddyProfile.findFirst.mockResolvedValue({ discordId: 'b1' })
    m.prisma.buddyPair.count.mockResolvedValue(0)
    expect(await getBuddyRecognition('M1')).toBeNull()
    m.prisma.buddyPair.count.mockResolvedValue(3)
    expect(await getBuddyRecognition('M1')).toEqual({ asBuddy: { helped: 3, level: 2 }, helpedBy: null })
    expect(m.prisma.buddyPair.count.mock.calls.at(-1)?.[0].where).toEqual({ buddyDiscordId: 'b1', status: 'COMPLETED' })
    // the opt-out lives in the profile query
    expect(m.prisma.buddyProfile.findFirst.mock.calls[0][0].where).toEqual({ memberId: 'M1', hideRecognition: false })
  })
  it('a trainee shows "Onboarded with help from" only for a COMPLETED, not-opted-out pair', async () => {
    m.prisma.buddyPair.findFirst.mockResolvedValue({ buddyDiscordId: 'b1' })
    m.prisma.buddyProfile.findUnique.mockResolvedValue({ memberId: 'MB', hideRecognition: false })
    expect(await getBuddyRecognition('MT')).toEqual({ asBuddy: null, helpedBy: { memberId: 'MB', name: 'Bea' } })
    expect(m.prisma.buddyPair.findFirst.mock.calls[0][0].where).toEqual({ traineeMemberId: 'MT', status: 'COMPLETED', traineeHideRecognition: false })
  })
  it('names no buddy who opted out, or whose name/profile cannot be resolved', async () => {
    m.prisma.buddyPair.findFirst.mockResolvedValue({ buddyDiscordId: 'b1' })
    m.prisma.buddyProfile.findUnique.mockResolvedValue({ memberId: 'MB', hideRecognition: true })
    expect(await getBuddyRecognition('MT')).toBeNull()
    m.prisma.buddyProfile.findUnique.mockResolvedValue({ memberId: null, hideRecognition: false })
    expect(await getBuddyRecognition('MT')).toBeNull()
    m.prisma.buddyProfile.findUnique.mockResolvedValue({ memberId: 'MB', hideRecognition: false })
    m.names = {}
    expect(await getBuddyRecognition('MT')).toBeNull()
  })
})

describe('getTopBuddies', () => {
  const g = (id: string, n: number, d: string) => ({ buddyDiscordId: id, _count: { _all: n }, _max: { completedAt: new Date(d) } })
  it('is null while off', async () => {
    m.on['buddy.publicRecognitionEnabled'] = false
    expect(await getTopBuddies()).toBeNull()
    expect(m.prisma.buddyPair.groupBy).not.toHaveBeenCalled()
  })
  it('ranks by completed count then most recent, skips opted-out and nameless buddies, caps at the limit', async () => {
    m.prisma.buddyPair.groupBy.mockResolvedValue([g('b1', 2, '2026-10-01'), g('b2', 2, '2026-11-01'), g('b3', 5, '2026-09-01'), g('b4', 9, '2026-11-02')])
    // b4 opted out (not returned by the hideRecognition:false query)
    m.prisma.buddyProfile.findMany.mockResolvedValue([
      { discordId: 'b1', memberId: 'M1' },
      { discordId: 'b2', memberId: 'M2' },
      { discordId: 'b3', memberId: 'M3' },
    ])
    expect(m.prisma.buddyPair.groupBy).not.toHaveBeenCalled()
    const top = await getTopBuddies(2)
    expect(top?.buddies).toEqual([
      { memberId: 'M3', name: 'Bix', helped: 5 },
      { memberId: 'M2', name: 'Bo', helped: 2 },
    ])
    expect(m.prisma.buddyPair.groupBy.mock.calls[0][0].where).toEqual({ status: 'COMPLETED' })
    expect(m.prisma.buddyProfile.findMany.mock.calls[0][0].where).toMatchObject({ hideRecognition: false })
  })
})

describe('rankBuddies / setRecognitionHidden', () => {
  it('breaks ties by most recent completion', () => {
    const r = rankBuddies([{ count: 1, lastAt: new Date('2026-01-01') }, { count: 1, lastAt: new Date('2026-02-01') }])
    expect(r[0].lastAt?.toISOString()).toContain('2026-02-01')
  })
  it('the trainee flag is per pair and only for the trainee; the buddy flag is on the profile', async () => {
    m.prisma.buddyPair.updateMany.mockResolvedValue({ count: 1 })
    expect(await setRecognitionHidden('t1', true, 'p1')).toBe(true)
    expect(m.prisma.buddyPair.updateMany).toHaveBeenCalledWith({ where: { id: 'p1', traineeDiscordId: 't1' }, data: { traineeHideRecognition: true } })
    m.prisma.buddyProfile.updateMany.mockResolvedValue({ count: 0 })
    expect(await setRecognitionHidden('b1', true)).toBe(false)
    expect(m.prisma.buddyProfile.updateMany).toHaveBeenCalledWith({ where: { discordId: 'b1' }, data: { hideRecognition: true } })
  })
})
