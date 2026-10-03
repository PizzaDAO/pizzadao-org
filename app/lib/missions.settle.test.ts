// Phase 1: settleLevels pays complete levels in order (D5), and approving a
// held completion is a RELEASE in the audit trail.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./db')
vi.mock('./economy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./economy')>()),
  getOrCreateEconomy: vi.fn().mockResolvedValue({}),
}))
vi.mock('./transactions', () => ({ logTransaction: vi.fn().mockResolvedValue({}) }))
vi.mock('./notifications', () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./discord', () => ({ getMembersWithRoles: vi.fn().mockResolvedValue([]) }))

import { approveMission, settleLevels } from './missions'
import { prisma } from './db'

const mockFn = (f: unknown) => f as ReturnType<typeof vi.fn>
const MISSIONS = [
  { id: 1, level: 1, reward: 69, levelTitle: null, isActive: true },
  { id: 2, level: 2, reward: 420, levelTitle: null, isActive: true },
  { id: 3, level: 2, reward: 420, levelTitle: null, isActive: true },
  { id: 4, level: 3, reward: 1337, levelTitle: null, isActive: true },
  { id: 6, level: 6, reward: 6942, levelTitle: null, isActive: true },
]
let approved: number[]
let paidLevels: number[]

beforeEach(() => {
  vi.clearAllMocks()
  approved = []
  paidLevels = []
  mockFn(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma))
  mockFn(prisma.$queryRaw).mockResolvedValue([])
  mockFn(prisma.economy.update).mockResolvedValue({})
  mockFn(prisma.mission.findMany).mockImplementation(async ({ where }: { where: { level?: number } }) =>
    where.level === undefined ? MISSIONS : MISSIONS.filter((m) => m.level === where.level),
  )
  mockFn(prisma.missionCompletion.findMany).mockImplementation(async () => approved.map((missionId) => ({ missionId })))
  mockFn(prisma.missionCompletion.count).mockImplementation(async ({ where }: { where: { missionId: { in: number[] } } }) =>
    where.missionId.in.filter((id) => approved.includes(id)).length,
  )
  mockFn(prisma.transaction.findMany).mockImplementation(async () => paidLevels.map((level) => ({ metadata: { level } })))
  mockFn(prisma.transaction.findFirst).mockResolvedValue(null)
})

describe('settleLevels', () => {
  it('pays every complete level in order', async () => {
    approved = [1, 2, 3]
    expect(await settleLevels('u')).toEqual([1, 2])
  })

  it('stops at the first incomplete level: a banked higher level is not paid yet', async () => {
    approved = [1, 4, 6] // L2 incomplete; L3 and L6 approved out of order
    expect(await settleLevels('u')).toEqual([1])
  })

  it('treats a paid level as complete and keeps going', async () => {
    approved = [2, 3, 4]
    paidLevels = [1]
    expect(await settleLevels('u')).toEqual([2, 3])
  })

  it('pays nothing twice: a level already paid is skipped', async () => {
    approved = [1]
    paidLevels = [1]
    expect(await settleLevels('u')).toEqual([])
    expect(prisma.economy.update).not.toHaveBeenCalled()
  })
})

describe('approveMission on a held (auto-verified) completion', () => {
  it('records a RELEASED event, clears the hold, and settles in order', async () => {
    const HELD = { id: 7, missionId: 2, discordId: 'u', status: 'PENDING', holdReason: 'NEW_ACCOUNT', mission: { ...MISSIONS[1], title: 'Say hi' } }
    mockFn(prisma.missionCompletion.findUnique).mockResolvedValue(HELD)
    mockFn(prisma.missionCompletion.updateMany).mockResolvedValue({ count: 1 })
    mockFn(prisma.missionCompletion.findUniqueOrThrow).mockResolvedValue({ ...HELD, status: 'APPROVED' })
    approved = [1, 2, 3]

    const r = await approveMission('capo-1', 7, 'looks fine')

    expect(mockFn(prisma.missionCompletion.updateMany).mock.calls[0][0].data).toMatchObject({ status: 'APPROVED', holdReason: null })
    expect(prisma.missionReviewEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ completionId: 7, actorId: 'capo-1', action: 'RELEASED', via: 'web', note: 'looks fine' }),
    })
    expect(r.levelsPaid).toEqual([1, 2])
  })
})
