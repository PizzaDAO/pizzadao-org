// $PEP audit: mission review + level-reward payout must be one-shot.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { approveMission, rejectMission, checkAndAwardLevelReward, submitMissionCompletion } from './missions'
import { prisma } from './db'

vi.mock('./db')
vi.mock('./economy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./economy')>()),
  getOrCreateEconomy: vi.fn().mockResolvedValue({}),
}))
vi.mock('./transactions', () => ({ logTransaction: vi.fn().mockResolvedValue({}) }))
vi.mock('./notifications', () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./discord', () => ({ getMembersWithRoles: vi.fn().mockResolvedValue([]) }))

import { logTransaction } from './transactions'

const mockFn = (f: unknown) => f as ReturnType<typeof vi.fn>

const LEVEL_MISSIONS = [
  { id: 1, level: 2, index: 0, title: 'Say hi', reward: 420, levelTitle: 'Pizza Noob', isActive: true },
  { id: 2, level: 2, index: 1, title: 'Post', reward: 420, levelTitle: 'Pizza Noob', isActive: true },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockFn(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma))
  mockFn(prisma.economy.update).mockResolvedValue({})
  mockFn(prisma.$queryRaw).mockResolvedValue([])
  mockFn(prisma.mission.findMany).mockResolvedValue(LEVEL_MISSIONS)
})

describe('checkAndAwardLevelReward', () => {
  it('locks the wallet, then pays and logs MISSION_REWARD with metadata.level in one transaction', async () => {
    mockFn(prisma.missionCompletion.count).mockResolvedValue(2)
    mockFn(prisma.transaction.findFirst).mockResolvedValue(null)

    await expect(checkAndAwardLevelReward('user-1', 2)).resolves.toBe(true)

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1) // SELECT ... FOR UPDATE
    const lockOrder = mockFn(prisma.$queryRaw).mock.invocationCallOrder[0]
    expect(lockOrder).toBeLessThan(mockFn(prisma.transaction.findFirst).mock.invocationCallOrder[0])
    expect(prisma.economy.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { wallet: { increment: 420 } } })
    expect(logTransaction).toHaveBeenCalledWith(prisma, 'user-1', 'MISSION_REWARD', 420, 'Mission reward: Level 2 - Pizza Noob', { level: 2 })
  })

  it('does not pay again when the level reward is already in the ledger (old or new format)', async () => {
    mockFn(prisma.missionCompletion.count).mockResolvedValue(2)
    mockFn(prisma.transaction.findFirst).mockResolvedValue({ id: 99 })

    await expect(checkAndAwardLevelReward('user-1', 2)).resolves.toBe(false)
    expect(prisma.economy.update).not.toHaveBeenCalled()

    const where = mockFn(prisma.transaction.findFirst).mock.calls[0][0].where
    expect(where.OR).toEqual([
      { metadata: { path: ['level'], equals: 2 } },
      { description: 'Mission reward: Level 2' },
      { description: { startsWith: 'Mission reward: Level 2 - ' } },
    ])
  })

  it('does not pay until every mission in the level is approved', async () => {
    mockFn(prisma.missionCompletion.count).mockResolvedValue(1)
    await expect(checkAndAwardLevelReward('user-1', 2)).resolves.toBe(false)
    expect(prisma.economy.update).not.toHaveBeenCalled()
  })
})

describe('approveMission / rejectMission', () => {
  const PENDING = { id: 7, missionId: 1, discordId: 'user-1', status: 'PENDING', mission: LEVEL_MISSIONS[0] }

  it('approves with a conditional PENDING -> APPROVED update', async () => {
    mockFn(prisma.missionCompletion.findUnique).mockResolvedValue(PENDING)
    mockFn(prisma.missionCompletion.updateMany).mockResolvedValue({ count: 1 })
    mockFn(prisma.missionCompletion.findUniqueOrThrow).mockResolvedValue({ ...PENDING, status: 'APPROVED' })
    mockFn(prisma.missionCompletion.count).mockResolvedValue(1)

    const result = await approveMission('admin-1', 7)

    expect(prisma.missionCompletion.updateMany).toHaveBeenCalledWith({
      where: { id: 7, status: 'PENDING' },
      data: expect.objectContaining({ status: 'APPROVED', reviewedBy: 'admin-1' }),
    })
    expect(result.status).toBe('APPROVED')
  })

  it('a concurrent second approval is rejected and never reaches the payout', async () => {
    mockFn(prisma.missionCompletion.findUnique).mockResolvedValue(PENDING) // stale read
    mockFn(prisma.missionCompletion.updateMany).mockResolvedValue({ count: 0 })

    await expect(approveMission('admin-2', 7)).rejects.toThrow('already been reviewed')
    // The conditional update ran in the review transaction; no payout followed.
    expect(prisma.economy.update).not.toHaveBeenCalled()
    expect(prisma.missionReviewEvent.create).not.toHaveBeenCalled()
  })

  it('reject is conditional too', async () => {
    mockFn(prisma.missionCompletion.findUnique).mockResolvedValue(PENDING)
    mockFn(prisma.missionCompletion.updateMany).mockResolvedValue({ count: 0 })
    await expect(rejectMission('admin-1', 7)).rejects.toThrow('already been reviewed')
  })
})

describe('submitMissionCompletion', () => {
  it('maps a concurrent duplicate submission (unique violation) to a 409', async () => {
    mockFn(prisma.mission.findUnique).mockResolvedValue({ ...LEVEL_MISSIONS[0], level: 1, title: 'x' })
    mockFn(prisma.missionCompletion.findUnique).mockResolvedValue(null)
    mockFn(prisma.missionCompletion.findMany).mockResolvedValue([])
    mockFn(prisma.missionCompletion.create).mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }))

    await expect(submitMissionCompletion('user-1', 1)).rejects.toThrow('already submitted')
  })
})
