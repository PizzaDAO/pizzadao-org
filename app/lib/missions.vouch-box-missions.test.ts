// L4.2 "Get vouched by a member" and L5.3 "Own a Rare Pizza Box" are ordinary
// required missions (mission-config.ts): levels are earned in order, rewards are
// paid when a level's missions are all done, and members already PAID for a
// level are never pushed back by missions added to it afterwards.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./db')
vi.mock('./economy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./economy')>()),
  getOrCreateEconomy: vi.fn().mockResolvedValue({}),
}))
vi.mock('./transactions', () => ({ logTransaction: vi.fn().mockResolvedValue({}) }))
vi.mock('./notifications', () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./discord', () => ({ getMembersWithRoles: vi.fn().mockResolvedValue([]) }))
vi.mock('./mission-verify/events', () => ({ emitMissionEvent: vi.fn(async () => null) }))

import { computeCurrentLevel, getCurrentLevel, settleLevels, submitMissionCompletion, getPaidSummary } from './missions'
import { MISSION_VERIFIER_CONFIG, LEVEL_4_REWARD, LEVEL_5_REWARD } from './mission-verify/mission-config'
import { prisma } from './db'
import { emitMissionEvent } from './mission-verify/events'

const mockFn = (f: unknown) => f as ReturnType<typeof vi.fn>
const REWARDS: Record<number, number> = { 1: 69, 2: 420, 3: 1337, 4: LEVEL_4_REWARD, 5: LEVEL_5_REWARD, 6: 6942, 7: 31415, 8: 69420 }

const MISSIONS = MISSION_VERIFIER_CONFIG.map((c) => ({
  id: c.level * 10 + c.index,
  level: c.level,
  index: c.index,
  reward: c.insert?.reward ?? REWARDS[c.level],
  levelTitle: null,
  isActive: true,
}))
const GOT_VOUCHED = 42
const BOX = 53
const ids = (level: number) => MISSIONS.filter((m) => m.level === level).map((m) => m.id)
const upTo = (level: number) => MISSIONS.filter((m) => m.level <= level).map((m) => m.id)

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

describe('the new missions are in the config', () => {
  it('L4.2 (vouch_received) and L5.3 (rare_pizza_box) share their level reward and are automatic', () => {
    const l42 = MISSIONS.find((m) => m.id === GOT_VOUCHED)!
    const l53 = MISSIONS.find((m) => m.id === BOX)!
    expect([l42.reward, l53.reward]).toEqual([LEVEL_4_REWARD, LEVEL_5_REWARD])
    const cfg = (level: number, index: number) => MISSION_VERIFIER_CONFIG.find((c) => c.level === level && c.index === index)!
    expect(cfg(4, 2).verifierKey).toBe('vouch_received')
    expect(cfg(5, 3).verifierKey).toBe('rare_pizza_box')
    expect(cfg(5, 3).description).toMatch(/Rare Pizza Box/)
  })
})

describe('no demotion: members already past the level keep it', () => {
  it('paid for level 4 before L4.2 existed: still past level 4 (level 5) without the vouch mission', () => {
    const doneBefore = new Set(upTo(4).filter((id) => id !== GOT_VOUCHED))
    expect(computeCurrentLevel(MISSIONS, doneBefore, new Set([1, 2, 3, 4]))).toBe(5)
    // ...but an unpaid member with the same approvals now waits for the vouch.
    expect(computeCurrentLevel(MISSIONS, doneBefore, new Set([1, 2, 3]))).toBe(4)
  })

  it('paid for level 5 before L5.3 existed: still past level 5 (level 6)', async () => {
    approved = upTo(5).filter((id) => id !== GOT_VOUCHED && id !== BOX && id !== 52)
    ledger = [1, 2, 3, 4, 5].map((level) => ({ metadata: { level } }))
    expect(await getCurrentLevel('u')).toBe(6)
    expect(await settleLevels('u')).toEqual([])
    expect(prisma.economy.update).not.toHaveBeenCalled() // nothing paid twice
  })
})

describe('rewards follow the missions', () => {
  it('finishing the rest of level 4 pays nothing until the vouch mission is approved, then pays once', async () => {
    ledger = [1, 2, 3].map((level) => ({ metadata: { level } }))
    approved = [...upTo(3), ...ids(4).filter((id) => id !== GOT_VOUCHED)]
    expect(await getCurrentLevel('u')).toBe(4) // held at level 4: the vouch is still missing
    expect(await settleLevels('u')).toEqual([])
    expect(prisma.economy.update).not.toHaveBeenCalled()

    approved = [...approved, GOT_VOUCHED]
    expect(await getCurrentLevel('u')).toBe(5)
    expect(await settleLevels('u')).toEqual([4])
  })

  it('level 5 waits for the Rare Pizza Box mission', async () => {
    ledger = [1, 2, 3, 4].map((level) => ({ metadata: { level } }))
    approved = [...upTo(4), ...ids(5).filter((id) => id !== BOX)]
    expect(await getCurrentLevel('u')).toBe(5)
    expect(await settleLevels('u')).toEqual([])
    approved = [...approved, BOX]
    expect(await getCurrentLevel('u')).toBe(6)
    expect(await settleLevels('u')).toEqual([5])
  })

  it('levels are earned in order even when higher missions are done first', () => {
    const vouchAndBoxOnly = new Set([GOT_VOUCHED, BOX])
    expect(computeCurrentLevel(MISSIONS, vouchAndBoxOnly)).toBe(1)
  })
})

describe('reaching a new level re-runs the level-5 checks', () => {
  it('paying a level asks for a level_reached re-check (box / vouch missions), paying nothing asks for none', async () => {
    ledger = [1, 2, 3].map((level) => ({ metadata: { level } }))
    approved = upTo(4)
    expect(await settleLevels('u')).toEqual([4])
    await vi.waitFor(() => expect(emitMissionEvent).toHaveBeenCalledWith('u', 'level_reached'))

    vi.mocked(emitMissionEvent).mockClear()
    ledger = [1, 2, 3, 4].map((level) => ({ metadata: { level } }))
    expect(await settleLevels('u')).toEqual([])
    await new Promise((r) => setTimeout(r, 10))
    expect(emitMissionEvent).not.toHaveBeenCalled()
  })
})

describe('submissions on any level', () => {
  it('are allowed above the current level and stay PENDING for review', async () => {
    const L5 = { id: 51, level: 5, index: 1, title: 'Do a selfie interview', reward: 1, isActive: true }
    mockFn(prisma.mission.findUnique).mockResolvedValue(L5)
    mockFn(prisma.missionCompletion.findUnique).mockResolvedValue(null)
    mockFn(prisma.missionCompletion.create).mockImplementation(async ({ data }: { data: object }) => ({ id: 9, ...data, mission: L5 }))
    const c = await submitMissionCompletion('brand-new-member', 51, 'https://youtu.be/x')
    expect(c.status).toBe('PENDING')
    expect(prisma.mission.findMany).not.toHaveBeenCalled() // the old "complete level N first" lookup is gone
  })
})

describe('getPaidSummary (earned PEP comes from the ledger)', () => {
  it('sums actual payouts and lists the paid levels', async () => {
    mockFn(prisma.transaction.findMany).mockResolvedValue([
      { metadata: { level: 1 }, amount: 69 },
      { description: 'Mission reward: Level 2 - Pizza Noob', amount: 420 },
    ])
    const r = await getPaidSummary('u')
    expect([...r.levels].sort()).toEqual([1, 2])
    expect(r.pep).toBe(489)
  })
})
