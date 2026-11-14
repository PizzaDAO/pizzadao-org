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
  return { prisma, toggle: vi.fn(), level: vi.fn(), memberId: vi.fn(), reward: vi.fn() }
})

vi.mock('@/app/lib/db', () => ({ prisma: m.prisma }))
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: m.toggle }))
vi.mock('@/app/lib/settings', () => ({
  loadSettings: async () => ({ get: (k: string) => ({ 'buddy.minLevel': 4, 'buddy.maxActivePerBuddy': 2, 'buddy.completionLevel': 2, 'buddy.rewardMissionId': 0, 'buddy.introText': 'x' })[k] }),
}))
vi.mock('@/app/lib/missions', () => ({ getCurrentLevel: m.level }))
vi.mock('@/app/lib/sheets/member-repository', () => ({ fetchMemberIdByDiscordId: m.memberId }))
vi.mock('./reward', () => ({ rewardBuddy: m.reward }))

import { adminAddBuddy, completeDuePairs, completeIfDue, createPair, endPair, saveOwnProfile } from './service'

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
    expect(await completeDuePairs()).toEqual({ checked: 2, completed: 1 })
    m.toggle.mockResolvedValue(false)
    expect(await completeDuePairs()).toEqual({ checked: 0, completed: 0 })
  })
})
