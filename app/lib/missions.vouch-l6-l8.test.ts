// L6.2 "Get vouched by 5 members" and L8.1 "Get vouched by 10 members"
// (mission-config.ts): ordinary automatic missions. Members already PAID for
// level 6 / 8 stay complete and are never paid again; members partway through
// now also need the vouches.
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

import { computeCurrentLevel, getCurrentLevel, settleLevels } from './missions'
import { MISSION_VERIFIER_CONFIG, LEVEL_6_REWARD, LEVEL_8_REWARD } from './mission-verify/mission-config'
import { getVerifier, vouchReceived } from './mission-verify/verifiers'
import { acceptsManualSubmission } from './mission-verify/policy'
import { prisma } from './db'

const mockFn = (f: unknown) => f as ReturnType<typeof vi.fn>
const REWARDS: Record<number, number> = { 1: 69, 2: 420, 3: 1337, 4: 3141, 5: 4269, 6: LEVEL_6_REWARD, 7: 31415, 8: LEVEL_8_REWARD }

const MISSIONS = MISSION_VERIFIER_CONFIG.map((c) => ({
  id: c.level * 10 + c.index,
  level: c.level,
  index: c.index,
  reward: c.insert?.reward ?? REWARDS[c.level],
  levelTitle: null,
  isActive: true,
}))
const VOUCH_5 = 62 // L6.2
const VOUCH_10 = 81 // L8.1
const upTo = (level: number) => MISSIONS.filter((m) => m.level <= level).map((m) => m.id)
const without = (ids: number[], ...drop: number[]) => ids.filter((id) => !drop.includes(id))

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
  it('L6.2 (min 5) and L8.1 (min 10) are automatic vouch_received missions with the shared level reward', () => {
    const cfg = (level: number, index: number) => MISSION_VERIFIER_CONFIG.find((c) => c.level === level && c.index === index)!
    expect(cfg(6, 2)).toMatchObject({ verifierKey: 'vouch_received', verifierParams: { min: 5, sources: ['PIZZADAO'] }, proofKind: 'NONE', insert: { reward: 6942 } })
    expect(cfg(8, 1)).toMatchObject({ verifierKey: 'vouch_received', verifierParams: { min: 10, sources: ['PIZZADAO'] }, proofKind: 'NONE', insert: { reward: 69420 } })
    expect(cfg(8, 0).verifierKey).toBe('manual') // L8.0 stays manual
    for (const c of [cfg(6, 2), cfg(8, 1)]) {
      expect(getVerifier(c.verifierKey)!.mode).toBe('auto')
      expect(acceptsManualSubmission({ verifierKey: c.verifierKey, proofKind: c.proofKind })).toBe(false) // no hand submissions
    }
  })

  it('the hint and failure text read right for 5 and 10', async () => {
    const src = { getVouchesReceived: vi.fn(async () => [2, 3, 4].map((n) => ({ followerId: `m-${n}`, source: 'PIZZADAO', createdAt: new Date(0) }))) }
    const ctx = { memberId: 'm-1', sources: src } as never
    const r5 = await vouchReceived.check(ctx, vouchReceived.parse({ min: 5, sources: ['PIZZADAO'] }))
    expect(r5).toMatchObject({ status: 'fail', reason: '3/5 vouches received', progress: { have: 3, need: 5 } })
    expect(JSON.stringify(r5)).toContain('Ask 2 members to vouch for you')
    const r10 = await vouchReceived.check(ctx, vouchReceived.parse({ min: 10, sources: ['PIZZADAO'] }))
    expect(r10).toMatchObject({ status: 'fail', reason: '3/10 vouches received', progress: { have: 3, need: 10 } })
    expect(JSON.stringify(r10)).toContain('Ask 7 members to vouch for you')
  })
})

describe('no demotion: members already paid for the level keep it', () => {
  it('paid for level 6 before L6.2 existed: still past level 6 (level 7), never paid again', async () => {
    approved = without(upTo(6), VOUCH_5, 82)
    ledger = [1, 2, 3, 4, 5, 6].map((level) => ({ metadata: { level } }))
    expect(computeCurrentLevel(MISSIONS, new Set(approved), new Set([1, 2, 3, 4, 5, 6]))).toBe(7)
    expect(await getCurrentLevel('u')).toBe(7)
    expect(await settleLevels('u')).toEqual([])
    expect(prisma.economy.update).not.toHaveBeenCalled()
  })

  it('paid for level 8 before L8.1 existed: stays complete and is never paid again', async () => {
    approved = without(upTo(8), VOUCH_10)
    ledger = [1, 2, 3, 4, 5, 6, 7, 8].map((level) => ({ metadata: { level } }))
    expect(await getCurrentLevel('u')).toBeGreaterThan(8)
    expect(await settleLevels('u')).toEqual([])
    expect(prisma.economy.update).not.toHaveBeenCalled()
  })
})

describe('members partway through now also need the vouches', () => {
  it('level 6 pays nothing until the 5-vouch mission is approved, then pays once', async () => {
    ledger = [1, 2, 3, 4, 5].map((level) => ({ metadata: { level } }))
    approved = without(upTo(6), VOUCH_5)
    expect(await getCurrentLevel('u')).toBe(6)
    expect(await settleLevels('u')).toEqual([])
    expect(prisma.economy.update).not.toHaveBeenCalled()

    approved = [...approved, VOUCH_5]
    expect(await getCurrentLevel('u')).toBe(7)
    expect(await settleLevels('u')).toEqual([6])
  })

  it('level 8 pays nothing until the 10-vouch mission is approved, then pays once', async () => {
    ledger = [1, 2, 3, 4, 5, 6, 7].map((level) => ({ metadata: { level } }))
    approved = without(upTo(8), VOUCH_10)
    expect(await settleLevels('u')).toEqual([])
    expect(prisma.economy.update).not.toHaveBeenCalled()

    approved = [...approved, VOUCH_10]
    expect(await settleLevels('u')).toEqual([8])
  })
})
