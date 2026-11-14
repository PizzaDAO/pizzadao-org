// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  prisma: {
    mission: { findUnique: vi.fn() },
    missionCompletion: { findUnique: vi.fn(), upsert: vi.fn() },
    buddyEvent: { create: vi.fn() },
  },
  toggle: vi.fn(),
  missionId: { value: 7 },
  pay: vi.fn(),
}))

vi.mock('@/app/lib/db', () => ({ prisma: m.prisma }))
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: m.toggle }))
vi.mock('@/app/lib/settings', () => ({ loadSettings: async () => ({ get: () => m.missionId.value }) }))
vi.mock('@/app/lib/missions', () => ({ payBonusRewards: m.pay }))

import { rewardBuddy } from './reward'

const pair = { pairId: 'p1', buddyDiscordId: '222222' }
const kinds = () => m.prisma.buddyEvent.create.mock.calls.map((c) => c[0].data.kind)

beforeEach(() => {
  vi.clearAllMocks()
  m.missionId.value = 7
  m.toggle.mockResolvedValue(true)
  m.prisma.mission.findUnique.mockResolvedValue({ id: 7, isActive: true, bonus: true })
  m.prisma.missionCompletion.findUnique.mockResolvedValue(null)
})

describe('rewardBuddy', () => {
  it('is a dry run while the toggle is off', async () => {
    m.toggle.mockResolvedValue(false)
    expect(await rewardBuddy(pair)).toBe('dry_run')
    expect(m.prisma.missionCompletion.upsert).not.toHaveBeenCalled()
    expect(m.pay).not.toHaveBeenCalled()
    expect(kinds()).toEqual(['reward_dry_run'])
  })
  it('marks the bonus mission approved for the buddy and pays it when on', async () => {
    expect(await rewardBuddy(pair)).toBe('granted')
    expect(m.prisma.missionCompletion.upsert.mock.calls[0][0].create).toMatchObject({ missionId: 7, discordId: '222222', status: 'APPROVED' })
    expect(m.pay).toHaveBeenCalledWith('222222')
    expect(kinds()).toEqual(['reward_granted'])
  })
  it('skips without a usable mission or when already done', async () => {
    m.missionId.value = 0
    expect(await rewardBuddy(pair)).toBe('no_mission')
    m.missionId.value = 7
    m.prisma.mission.findUnique.mockResolvedValue({ id: 7, isActive: true, bonus: false })
    expect(await rewardBuddy(pair)).toBe('mission_unusable')
    m.prisma.mission.findUnique.mockResolvedValue({ id: 7, isActive: true, bonus: true })
    m.prisma.missionCompletion.findUnique.mockResolvedValue({ status: 'APPROVED' })
    expect(await rewardBuddy(pair)).toBe('already_done')
    expect(m.prisma.missionCompletion.upsert).not.toHaveBeenCalled()
  })
  it('an already APPROVED completion still runs the (idempotent) payout, and a failing payout is not logged as done', async () => {
    m.prisma.missionCompletion.findUnique.mockResolvedValue({ status: 'APPROVED' })
    expect(await rewardBuddy(pair)).toBe('already_done')
    expect(m.pay).toHaveBeenCalledWith('222222')
    expect(kinds()).toEqual(['reward_skipped'])
    m.prisma.buddyEvent.create.mockClear()
    m.pay.mockRejectedValueOnce(new Error('sheet down'))
    await expect(rewardBuddy(pair)).rejects.toThrow('sheet down')
    expect(kinds()).toEqual([]) // stays retryable
  })
})
