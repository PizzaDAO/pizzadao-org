// Bonus missions: optional for their level; level 0 = "Anytime"; own once-only reward.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./db')
vi.mock('./economy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./economy')>()),
  getOrCreateEconomy: vi.fn().mockResolvedValue({}),
  creditInTx: vi.fn().mockResolvedValue({}),
  lockWallet: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./notifications', () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./discord', () => ({ getMembersWithRoles: vi.fn().mockResolvedValue([]) }))

import { computeCurrentLevel, getCurrentLevel, payBonusRewards, REQUIRED_MISSION_WHERE, settleLevels } from './missions'
import { creditInTx } from './economy'
import { prisma } from './db'

const mockFn = (f: unknown) => f as ReturnType<typeof vi.fn>

// L1: ids 1, 2 (2 is bonus); L2: id 3; L0 Anytime: id 9 (bonus)
const ALL = [
  { id: 1, level: 1, bonus: false },
  { id: 2, level: 1, bonus: true },
  { id: 3, level: 2, bonus: false },
  { id: 9, level: 0, bonus: true },
]
const matches = (m: (typeof ALL)[number], where: Record<string, unknown>) =>
  (where.bonus === undefined || m.bonus === where.bonus) &&
  (where.level === undefined ||
    (typeof where.level === 'number' ? m.level === where.level : m.level > (where.level as { gt: number }).gt))

let approved: number[]

beforeEach(() => {
  vi.clearAllMocks()
  approved = []
  mockFn(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma))
  mockFn(prisma.mission.findMany).mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
    ALL.filter((m) => matches(m, where)).map((m) => ({ ...m, reward: 100, levelTitle: null })),
  )
  mockFn(prisma.missionCompletion.findMany).mockImplementation(async (args: { where: { mission?: unknown } }) =>
    args.where.mission
      ? approved.filter((id) => id === 9).map((missionId) => ({ missionId, mission: { title: 'Writer', bonusReward: 50 } }))
      : approved.map((missionId) => ({ missionId })),
  )
  mockFn(prisma.missionCompletion.count).mockImplementation(async ({ where }: { where: { missionId: { in: number[] } } }) =>
    where.missionId.in.filter((id) => approved.includes(id)).length,
  )
  mockFn(prisma.transaction.findMany).mockResolvedValue([])
  mockFn(prisma.transaction.findFirst).mockResolvedValue(null)
})

describe('required missions', () => {
  it('the filter excludes bonus and level-0 missions', () => {
    expect(REQUIRED_MISSION_WHERE).toEqual({ isActive: true, bonus: false, level: { gt: 0 } })
  })

  it('a mission turning bonus never lowers a level: members only move up', () => {
    const before = [{ id: 1, level: 1 }, { id: 2, level: 1 }, { id: 3, level: 2 }]
    const after = [{ id: 1, level: 1 }, { id: 3, level: 2 }] // 2 became bonus
    for (const done of [[], [1], [2], [1, 2], [1, 3], [1, 2, 3]]) {
      const b = computeCurrentLevel(before, new Set(done), new Set())
      const a = computeCurrentLevel(after, new Set(done), new Set())
      expect(a).toBeGreaterThanOrEqual(b)
    }
    expect(computeCurrentLevel(after, new Set([1]), new Set())).toBe(2) // was 1
  })

  it('getCurrentLevel ignores bonus and Anytime missions', async () => {
    approved = [1] // the required L1 mission only
    expect(await getCurrentLevel('u')).toBe(2)
    approved = [1, 3]
    expect(await getCurrentLevel('u')).toBe(3)
  })

  it('settleLevels pays a level once its required missions are approved, without the bonus one', async () => {
    approved = [1]
    expect(await settleLevels('u')).toEqual([1])
    expect(mockFn(creditInTx)).toHaveBeenCalledWith(expect.anything(), 'u', 100, 'MISSION_REWARD', expect.stringContaining('Level 1'), { level: 1 })
  })
})

describe('payBonusRewards', () => {
  it('pays an approved bonus mission once, with a ledger marker that is not a level', async () => {
    approved = [9]
    expect(await payBonusRewards('u')).toEqual([9])
    expect(mockFn(creditInTx)).toHaveBeenCalledWith(expect.anything(), 'u', 50, 'MISSION_REWARD', 'Bonus mission reward: Writer', { bonusMissionId: 9 })
  })

  it('is idempotent: an existing ledger row for the mission pays nothing', async () => {
    approved = [9]
    mockFn(prisma.transaction.findFirst).mockResolvedValue({ id: 1 })
    expect(await payBonusRewards('u')).toEqual([])
    expect(mockFn(creditInTx)).not.toHaveBeenCalled()
  })

  it('pays nothing when no bonus mission is approved', async () => {
    expect(await payBonusRewards('u')).toEqual([])
  })
})
