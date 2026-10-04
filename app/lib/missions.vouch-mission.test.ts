// Adding L5.2 "Vouch for another member" (mission-config.ts): members already
// PAID for level 5 stay complete and are never paid again; members partway
// through level 5 now also need the vouch. Level titles are renamed by the same
// migration, and the paid marker still matches ledger rows written under the
// old (or no) title.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./db')
vi.mock('./economy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./economy')>()),
  getOrCreateEconomy: vi.fn().mockResolvedValue({}),
}))
vi.mock('./transactions', () => ({ logTransaction: vi.fn().mockResolvedValue({}) }))
vi.mock('./notifications', () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./discord', () => ({ getMembersWithRoles: vi.fn().mockResolvedValue([]) }))

import { computeCurrentLevel, getCurrentLevel, settleLevels } from './missions'
import { MISSION_VERIFIER_CONFIG } from './mission-verify/mission-config'
import { prisma } from './db'

const mockFn = (f: unknown) => f as ReturnType<typeof vi.fn>
const REWARDS: Record<number, number> = { 1: 69, 2: 420, 3: 1337, 4: 3141, 5: 4269, 6: 6942, 7: 31415, 8: 69420 }

/** Every mission row after the migration, L5.2 included (ids = level * 10 + index). */
const MISSIONS = MISSION_VERIFIER_CONFIG.map((c) => ({
  id: c.level * 10 + c.index,
  level: c.level,
  index: c.index,
  reward: c.insert?.reward ?? REWARDS[c.level],
  levelTitle: null,
  isActive: true,
}))
const VOUCH = 52
const BEFORE_VOUCH = MISSIONS.filter((m) => m.level < 5 || m.id === 50 || m.id === 51).map((m) => m.id) // L1-L4 + L5.0 + L5.1

let approved: number[]
let ledger: Array<{ metadata?: unknown; description?: string }>

beforeEach(() => {
  vi.clearAllMocks()
  approved = []
  ledger = []
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
  mockFn(prisma.transaction.findMany).mockImplementation(async () => ledger)
  mockFn(prisma.transaction.findFirst).mockResolvedValue(null)
})

describe('L5.2 vouch mission added to level 5', () => {
  it('the config adds it at L5 index 2 with the shared L5 reward', () => {
    expect(MISSIONS.filter((m) => m.level === 5).map((m) => [m.id, m.reward])).toEqual([[50, 4269], [51, 4269], [VOUCH, 4269]])
  })

  it('a member already PAID for level 5 stays complete (level 6) and is never paid again', async () => {
    approved = BEFORE_VOUCH // finished L5 before the vouch mission existed
    ledger = [1, 2, 3, 4, 5].map((level) => ({ metadata: { level } }))

    expect(computeCurrentLevel(MISSIONS, new Set(approved), new Set([1, 2, 3, 4, 5]))).toBe(6)
    expect(await getCurrentLevel('u')).toBe(6)
    expect(await settleLevels('u')).toEqual([])
    expect(prisma.economy.update).not.toHaveBeenCalled()
  })

  it('old ledger rows without metadata (description only, old or no title) still mark the level paid', async () => {
    approved = BEFORE_VOUCH
    ledger = [
      ...[1, 2, 3, 4].map((level) => ({ metadata: { level } })),
      { description: 'Mission reward: Level 5' }, // L5 had no levelTitle when it was paid
    ]
    expect(await getCurrentLevel('u')).toBe(6)
    expect(await settleLevels('u')).toEqual([])
  })

  it('a member partway through level 5 now also needs the vouch: no payout until it is approved', async () => {
    approved = BEFORE_VOUCH
    ledger = [1, 2, 3, 4].map((level) => ({ metadata: { level } }))

    expect(await getCurrentLevel('u')).toBe(5)
    expect(await settleLevels('u')).toEqual([])
    expect(prisma.economy.update).not.toHaveBeenCalled()

    approved = [...BEFORE_VOUCH, VOUCH]
    expect(await getCurrentLevel('u')).toBe(6)
    expect(await settleLevels('u')).toEqual([5])
  })
})
