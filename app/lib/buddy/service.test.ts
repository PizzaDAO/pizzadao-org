// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() })
  const prisma = {
    buddyProfile: model(),
    buddyPair: model(),
    buddyEvent: model(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  }
  return { prisma, toggle: vi.fn(), level: vi.fn(), memberId: vi.fn(), reward: vi.fn(), intro: vi.fn(), cancel: vi.fn() }
})

vi.mock('@/app/lib/db', () => ({ prisma: m.prisma }))
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: m.toggle }))
vi.mock('@/app/lib/settings', () => ({
  loadSettings: async () => ({ get: (k: string) => ({ 'buddy.minLevel': 4, 'buddy.maxActivePerBuddy': 2, 'buddy.completionLevel': 2, 'buddy.rewardMissionId': 0, 'buddy.introText': 'x', 'buddy.introRecheckHours': 24, 'buddy.maxCancelsPerRun': 3 })[k] }),
}))
vi.mock('@/app/lib/missions', () => ({ getCurrentLevel: m.level }))
vi.mock('@/app/lib/sheets/member-repository', () => ({ fetchMemberIdByDiscordId: m.memberId }))
vi.mock('./reward', () => ({ rewardBuddy: m.reward }))
vi.mock('./intro', () => ({ introducePair: m.intro, cancelForNoAccess: m.cancel }))

import { adminAddBuddy, adminRemoveBuddy, completeDuePairs, completeIfDue, createPair, endPair, retryDeferredIntros, retryPendingRewards, saveOwnProfile } from './service'

const TRAINEE = '111111'
const BUDDY = '222222'
const p = m.prisma

beforeEach(() => {
  vi.clearAllMocks()
  m.toggle.mockResolvedValue(true)
  m.level.mockResolvedValue(1)
  m.memberId.mockResolvedValue('M1')
  p.$transaction.mockImplementation(async (fn: (tx: typeof p) => unknown) => fn(p))
  p.buddyProfile.findUnique.mockResolvedValue({ discordId: BUDDY, active: true, paused: false, maxActive: 2 })
  p.buddyPair.count.mockResolvedValue(0)
  p.buddyPair.create.mockResolvedValue({ id: 'pair1' })
  p.buddyPair.updateMany.mockResolvedValue({ count: 1 })
})

describe('saveOwnProfile (opt-in eligibility)', () => {
  beforeEach(() => {
    p.buddyProfile.findUnique.mockResolvedValue(null)
    p.buddyProfile.upsert.mockImplementation(async ({ create }: { create: object }) => ({ active: true, paused: false, maxActive: 2, languages: [], ...create }))
  })
  it('does nothing while the system is off', async () => {
    m.toggle.mockResolvedValue(false)
    expect(await saveOwnProfile(BUDDY, { active: true })).toEqual({ ok: false, reason: 'disabled' })
    expect(p.buddyProfile.upsert).not.toHaveBeenCalled()
  })
  it('refuses a member below the minimum level', async () => {
    m.level.mockResolvedValue(3)
    expect(await saveOwnProfile(BUDDY, { active: true })).toEqual({ ok: false, reason: 'not_eligible' })
    expect(p.buddyProfile.upsert).not.toHaveBeenCalled()
  })
  it('accepts a member at the minimum level and clamps their limit to the setting', async () => {
    m.level.mockResolvedValue(4)
    const r = await saveOwnProfile(BUDDY, { active: true, maxActive: 9 })
    expect(r.ok).toBe(true)
    expect(p.buddyProfile.upsert.mock.calls[0][0].create).toMatchObject({ discordId: BUDDY, active: true, maxActive: 2 })
  })
  it('lets an admin-added buddy opt in below the level, and anyone pause or leave', async () => {
    m.level.mockResolvedValue(1)
    p.buddyProfile.findUnique.mockResolvedValue({ discordId: BUDDY, active: false, paused: false, maxActive: 1, languages: [], addedBy: 'adm', memberId: 'M1' })
    expect((await saveOwnProfile(BUDDY, { active: true })).ok).toBe(true)
    p.buddyProfile.findUnique.mockResolvedValue({ discordId: BUDDY, active: true, paused: false, maxActive: 1, languages: [], addedBy: null, memberId: 'M1' })
    m.level.mockResolvedValue(1)
    expect((await saveOwnProfile(BUDDY, { paused: true })).ok).toBe(true)
    expect((await saveOwnProfile(BUDDY, { active: false })).ok).toBe(true)
  })
})

describe('saveOwnProfile (no stray rows, removal, default load)', () => {
  beforeEach(() => {
    p.buddyProfile.findUnique.mockResolvedValue(null)
    p.buddyProfile.upsert.mockImplementation(async ({ create }: { create: object }) => ({ active: true, paused: false, maxActive: 2, languages: [], ...create }))
  })
  it('does not create a row for a pause, leave or empty save', async () => {
    expect((await saveOwnProfile(BUDDY, { paused: true })).ok).toBe(false)
    expect((await saveOwnProfile(BUDDY, { active: false })).ok).toBe(false)
    expect((await saveOwnProfile(BUDDY, {})).ok).toBe(false)
    expect(p.buddyProfile.upsert).not.toHaveBeenCalled()
  })
  it('defaults the self opt-in load to the buddy.maxActivePerBuddy setting', async () => {
    m.level.mockResolvedValue(4)
    await saveOwnProfile(BUDDY, { active: true })
    expect(p.buddyProfile.upsert.mock.calls[0][0].create).toMatchObject({ maxActive: 2 })
  })
  it('refuses a removed buddy any change, even one with a high level', async () => {
    m.level.mockResolvedValue(9)
    p.buddyProfile.findUnique.mockResolvedValue({ discordId: BUDDY, active: false, removedAt: new Date(), addedBy: null, maxActive: 2, languages: [] })
    expect(await saveOwnProfile(BUDDY, { active: true })).toEqual({ ok: false, reason: 'not_eligible' })
    expect(p.buddyProfile.upsert).not.toHaveBeenCalled()
  })
})

describe('admin remove and re-add', () => {
  it('remove clears addedBy and records the removal marker', async () => {
    p.buddyProfile.updateMany.mockResolvedValue({ count: 1 })
    expect(await adminRemoveBuddy(BUDDY)).toEqual({ ok: true })
    expect(p.buddyProfile.updateMany.mock.calls[0][0]).toMatchObject({ where: { discordId: BUDDY }, data: { active: false, addedBy: null, removedAt: expect.any(Date) } })
  })
  it('re-adding clears the marker', async () => {
    await adminAddBuddy(BUDDY, 'adm')
    expect(p.buddyProfile.upsert.mock.calls[0][0].update).toMatchObject({ active: true, removedAt: null })
  })
})

describe('reward retry', () => {
  it('records reward_pending when the reward throws at completion', async () => {
    m.reward.mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    p.buddyEvent.create.mockResolvedValue({})
    await completeIfDue({ id: 'pair1', traineeDiscordId: TRAINEE, buddyDiscordId: BUDDY }, 3, 2)
    expect(p.buddyEvent.create.mock.calls.map((c) => c[0].data.kind)).toEqual(['completed', 'reward_pending'])
  })
  it('retries unrewarded completed pairs only while rewardEnabled is on', async () => {
    p.buddyPair.findMany.mockResolvedValue([{ id: 'pair1', buddyDiscordId: BUDDY }])
    m.reward.mockResolvedValue('granted')
    m.toggle.mockImplementation(async (k: string) => k !== 'buddy.rewardEnabled')
    expect(await retryPendingRewards()).toBe(0)
    expect(m.reward).not.toHaveBeenCalled()
    m.toggle.mockResolvedValue(true)
    expect(await retryPendingRewards()).toBe(1)
    expect(m.reward).toHaveBeenCalledWith({ pairId: 'pair1', buddyDiscordId: BUDDY })
    expect(p.buddyPair.findMany.mock.calls[0][0].where).toMatchObject({ status: 'COMPLETED', events: { some: { kind: 'reward_pending' }, none: { kind: { in: ['reward_granted', 'reward_skipped'] } } } })
  })
  it('the daily run includes the retry count', async () => {
    p.buddyPair.findMany.mockResolvedValue([])
    expect(await completeDuePairs()).toEqual({ checked: 0, completed: 0, rewardsRetried: 0, intros: { opened: 0, waiting: 0, cancelled: 0, held: 0 } })
  })
})

describe('deferred intro retry', () => {
  const due = (id: string, hoursAgo?: number) => ({ id, events: hoursAgo === undefined ? [] : [{ at: new Date(Date.now() - hoursAgo * 3600 * 1000) }] })
  beforeEach(() => {
    m.toggle.mockResolvedValue(true)
    m.cancel.mockResolvedValue(true)
    p.buddyEvent.findFirst.mockResolvedValue(null)
    p.buddyEvent.create.mockResolvedValue({})
  })
  it('does nothing while intro threads are off', async () => {
    m.toggle.mockImplementation(async (k: string) => k !== 'buddy.introThreadsEnabled')
    expect(await retryDeferredIntros()).toEqual({ opened: 0, waiting: 0, cancelled: 0, held: 0 })
    expect(p.buddyPair.findMany).not.toHaveBeenCalled()
  })
  it('asks oldest pairs first, only MATCHED with a deferral and no thread', async () => {
    p.buddyPair.findMany.mockResolvedValue([])
    await retryDeferredIntros()
    const q = p.buddyPair.findMany.mock.calls[0][0]
    expect(q.where).toMatchObject({ status: 'MATCHED', introducedAt: null, threadId: null, events: { some: { kind: 'intro_deferred' } } })
    expect(q.orderBy).toEqual({ createdAt: 'asc' })
  })
  it('skips pairs still inside their wait BEFORE the cap, so they cannot crowd out due ones', async () => {
    p.buddyPair.findMany.mockResolvedValue([due('w1', 1), due('w2', 2), due('d1', 30), due('d2')])
    m.intro.mockResolvedValue({ mode: 'live', ok: true, threadId: '1' })
    const r = await retryDeferredIntros(2)
    expect(m.intro.mock.calls.map((c) => c[0])).toEqual(['d1', 'd2'])
    expect(r).toMatchObject({ opened: 2, waiting: 2 })
  })
  it('tallies opened / waiting / cancelled (cancelling with the pair who list)', async () => {
    p.buddyPair.findMany.mockResolvedValue([due('a', 30), due('b', 30), due('c', 30)])
    m.intro
      .mockResolvedValueOnce({ mode: 'live', ok: true, threadId: '1' })
      .mockResolvedValueOnce({ mode: 'live', ok: false, reason: 'access_unknown' })
      .mockResolvedValueOnce({ mode: 'live', ok: false, reason: 'no_channel_access', cancelDue: { who: ['buddy'] } })
    expect(await retryDeferredIntros()).toEqual({ opened: 1, waiting: 1, cancelled: 1, held: 0 })
    expect(m.intro).toHaveBeenCalledWith('a', 'system', {}, { deferCancel: true })
    expect(m.cancel).toHaveBeenCalledWith('c', ['buddy'], 'system')
  })
  it('safety brake: more due cancellations than the limit cancels none and flags each pair once', async () => {
    p.buddyPair.findMany.mockResolvedValue([due('a', 30), due('b', 30), due('c', 30), due('d', 30)])
    m.intro.mockResolvedValue({ mode: 'live', ok: false, reason: 'no_channel_access', cancelDue: { who: ['trainee'] } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await retryDeferredIntros()).toEqual({ opened: 0, waiting: 0, cancelled: 0, held: 4 })
    expect(m.cancel).not.toHaveBeenCalled()
    expect(p.buddyEvent.create.mock.calls.map((c) => c[0].data.kind)).toEqual(['cancel_held', 'cancel_held', 'cancel_held', 'cancel_held'])
    // already flagged: no second event
    p.buddyEvent.create.mockClear()
    p.buddyEvent.findFirst.mockResolvedValue({ id: 'e' })
    await retryDeferredIntros()
    expect(p.buddyEvent.create).not.toHaveBeenCalled()
  })
  it('at or under the limit the cancellations go ahead', async () => {
    p.buddyPair.findMany.mockResolvedValue([due('a', 30), due('b', 30), due('c', 30)])
    m.intro.mockResolvedValue({ mode: 'live', ok: false, reason: 'no_channel_access', cancelDue: { who: ['trainee'] } })
    expect(await retryDeferredIntros()).toMatchObject({ cancelled: 3, held: 0 })
  })
})
