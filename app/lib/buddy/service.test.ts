// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => {
  const model = () => ({ findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() })
  const prisma = {
    buddyProfile: model(),
    buddyPair: model(),
    buddyEvent: model(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  }
  return { prisma, toggle: vi.fn(), level: vi.fn(), memberId: vi.fn(), reward: vi.fn(), intro: vi.fn() }
})

vi.mock('@/app/lib/db', () => ({ prisma: m.prisma }))
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: m.toggle }))
vi.mock('@/app/lib/settings', () => ({
  loadSettings: async () => ({ get: (k: string) => ({ 'buddy.minLevel': 4, 'buddy.maxActivePerBuddy': 2, 'buddy.completionLevel': 2, 'buddy.rewardMissionId': 0, 'buddy.introText': 'x' })[k] }),
}))
vi.mock('@/app/lib/missions', () => ({ getCurrentLevel: m.level }))
vi.mock('@/app/lib/sheets/member-repository', () => ({ fetchMemberIdByDiscordId: m.memberId }))
vi.mock('./reward', () => ({ rewardBuddy: m.reward }))
vi.mock('./intro', () => ({ introducePair: m.intro }))

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
    expect(await completeDuePairs()).toEqual({ checked: 0, completed: 0, rewardsRetried: 0, intros: { opened: 0, waiting: 0, cancelled: 0 } })
  })
})

describe('deferred intro retry', () => {
  it('does nothing while intro threads are off', async () => {
    m.toggle.mockImplementation(async (k: string) => k !== 'buddy.introThreadsEnabled')
    expect(await retryDeferredIntros()).toEqual({ opened: 0, waiting: 0, cancelled: 0 })
    expect(p.buddyPair.findMany).not.toHaveBeenCalled()
  })
  it('retries only MATCHED pairs with a deferral and no thread, and tallies the outcomes', async () => {
    m.toggle.mockResolvedValue(true)
    p.buddyPair.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    m.intro
      .mockResolvedValueOnce({ mode: 'live', ok: true, threadId: '1' })
      .mockResolvedValueOnce({ mode: 'live', ok: false, reason: 'waiting_for_access', waiting: true })
      .mockResolvedValueOnce({ mode: 'live', ok: false, reason: 'no_channel_access', cancelled: true })
    expect(await retryDeferredIntros()).toEqual({ opened: 1, waiting: 1, cancelled: 1 })
    expect(p.buddyPair.findMany.mock.calls[0][0].where).toMatchObject({ status: 'MATCHED', introducedAt: null, threadId: null, events: { some: { kind: 'intro_deferred' } } })
    expect(m.intro).toHaveBeenCalledWith('a', 'system')
  })
})


describe('createPair', () => {
  it('creates a MATCHED pair, writes the audit row and takes the per-buddy lock', async () => {
    const r = await createPair({ traineeDiscordId: TRAINEE, buddyDiscordId: BUDDY }, 'adm')
    expect(r).toEqual({ ok: true, pairId: 'pair1', traineeMemberId: 'M1' })
    expect(p.$executeRaw).toHaveBeenCalledTimes(1)
    expect(p.buddyPair.create.mock.calls[0][0].data).toMatchObject({ traineeDiscordId: TRAINEE, buddyDiscordId: BUDDY, status: 'MATCHED', createdBy: 'adm' })
    expect(p.buddyEvent.create.mock.calls[0][0].data).toMatchObject({ pairId: 'pair1', kind: 'paired', actor: 'adm' })
  })
  it('refuses when the system is off or the ids are bad', async () => {
    m.toggle.mockResolvedValue(false)
    expect(await createPair({ traineeDiscordId: TRAINEE, buddyDiscordId: BUDDY }, 'adm')).toEqual({ ok: false, reason: 'disabled' })
    m.toggle.mockResolvedValue(true)
    expect(await createPair({ traineeDiscordId: 'x', buddyDiscordId: BUDDY }, 'adm')).toEqual({ ok: false, reason: 'bad_input' })
    expect(p.buddyPair.create).not.toHaveBeenCalled()
  })
  it('enforces one active buddy per trainee', async () => {
    p.buddyPair.count.mockImplementation(async ({ where }: { where: { traineeDiscordId?: string } }) => (where.traineeDiscordId ? 1 : 0))
    expect(await createPair({ traineeDiscordId: TRAINEE, buddyDiscordId: BUDDY }, 'adm')).toEqual({ ok: false, reason: 'trainee_has_buddy' })
    expect(p.buddyPair.create).not.toHaveBeenCalled()
  })
  it('enforces the buddy load cap', async () => {
    p.buddyPair.count.mockImplementation(async ({ where }: { where: { buddyDiscordId?: string } }) => (where.buddyDiscordId ? 2 : 0))
    expect(await createPair({ traineeDiscordId: TRAINEE, buddyDiscordId: BUDDY }, 'adm')).toEqual({ ok: false, reason: 'buddy_full' })
    expect(p.buddyPair.create).not.toHaveBeenCalled()
  })
  it('refuses a paused or non-buddy and a trainee who already finished', async () => {
    p.buddyProfile.findUnique.mockResolvedValue({ active: true, paused: true, maxActive: 2 })
    expect(await createPair({ traineeDiscordId: TRAINEE, buddyDiscordId: BUDDY }, 'adm')).toEqual({ ok: false, reason: 'buddy_paused' })
    p.buddyProfile.findUnique.mockResolvedValue(null)
    expect(await createPair({ traineeDiscordId: TRAINEE, buddyDiscordId: BUDDY }, 'adm')).toEqual({ ok: false, reason: 'buddy_unavailable' })
    p.buddyProfile.findUnique.mockResolvedValue({ active: true, paused: false, maxActive: 2 })
    m.level.mockResolvedValue(3)
    expect(await createPair({ traineeDiscordId: TRAINEE, buddyDiscordId: BUDDY }, 'adm')).toEqual({ ok: false, reason: 'trainee_finished' })
  })
  it('maps the unique-index backstop to trainee_has_buddy', async () => {
    p.buddyPair.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }))
    expect(await createPair({ traineeDiscordId: TRAINEE, buddyDiscordId: BUDDY }, 'adm')).toEqual({ ok: false, reason: 'trainee_has_buddy' })
  })
})

describe('endPair', () => {
  it('ends an active pair once and records why', async () => {
    expect(await endPair('pair1', 'adm', 'not a fit')).toEqual({ ok: true })
    expect(p.buddyPair.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'pair1', status: { in: ['QUEUED', 'MATCHED', 'INTRODUCED'] } }, data: { status: 'ENDED', endedReason: 'not a fit' } })
    p.buddyPair.updateMany.mockResolvedValue({ count: 0 })
    expect(await endPair('pair1', 'adm', '')).toEqual({ ok: false })
  })
})

describe('adminAddBuddy', () => {
  it('adds without a level check and remembers who did it', async () => {
    expect(await adminAddBuddy(BUDDY, 'adm')).toEqual({ ok: true })
    expect(p.buddyProfile.upsert.mock.calls[0][0].create).toMatchObject({ discordId: BUDDY, active: true, addedBy: 'adm' })
    expect(m.level).not.toHaveBeenCalled()
    expect(await adminAddBuddy('nope', 'adm')).toEqual({ ok: false, reason: 'bad_input' })
  })
})

describe('completion', () => {
  const pair = { id: 'pair1', traineeDiscordId: TRAINEE, buddyDiscordId: BUDDY }
  it('completes when the trainee has finished the configured level, and rewards once', async () => {
    expect(await completeIfDue(pair, 3, 2)).toBe(true)
    expect(p.buddyPair.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'COMPLETED' })
    expect(m.reward).toHaveBeenCalledWith({ pairId: 'pair1', buddyDiscordId: BUDDY })
  })
  it('does not complete before that level', async () => {
    expect(await completeIfDue(pair, 2, 2)).toBe(false)
    expect(p.buddyPair.updateMany).not.toHaveBeenCalled()
    expect(m.reward).not.toHaveBeenCalled()
  })
  it('a lost race neither logs nor rewards', async () => {
    p.buddyPair.updateMany.mockResolvedValue({ count: 0 })
    expect(await completeIfDue(pair, 3, 2)).toBe(false)
    expect(m.reward).not.toHaveBeenCalled()
  })
  it('a failing reward does not undo the completion', async () => {
    m.reward.mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await completeIfDue(pair, 3, 2)).toBe(true)
  })
  it('the run completes only the pairs whose trainee is done, and is a no-op while off', async () => {
    p.buddyPair.findMany.mockResolvedValue([pair, { id: 'pair2', traineeDiscordId: '333333', buddyDiscordId: BUDDY }])
    m.level.mockImplementation(async (id: string) => (id === TRAINEE ? 3 : 1))
    expect(await completeDuePairs()).toMatchObject({ checked: 2, completed: 1 })
    m.toggle.mockResolvedValue(false)
    expect(await completeDuePairs()).toMatchObject({ checked: 0, completed: 0 })
  })
})
