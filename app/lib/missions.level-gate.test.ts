// Level gates (Community Call, 2026-10-26): missions on any level, levels
// earned in order; level 4 needs a vouch received, level 5 a Rare Pizza Box;
// nobody who already had the level is demoted.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./db')
vi.mock('./economy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./economy')>()),
  getOrCreateEconomy: vi.fn().mockResolvedValue({}),
}))
vi.mock('./transactions', () => ({ logTransaction: vi.fn().mockResolvedValue({}) }))
vi.mock('./notifications', () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./discord', () => ({ getMembersWithRoles: vi.fn().mockResolvedValue([]) }))
vi.mock('./sheets/member-repository', () => ({ fetchMemberIdByDiscordId: vi.fn() }))
vi.mock('./nft-config', () => ({ getNFTContracts: vi.fn(), ALCHEMY_CHAIN_URLS: {} }))
vi.mock('./nft', () => ({ holdsNFTOfContract: vi.fn() }))
vi.mock('./wallet-lookup', () => ({ getWalletForMember: vi.fn(), getEvmWalletsForMember: vi.fn() }))
vi.mock('../api/lib/cache', () => ({ cacheGet: vi.fn().mockResolvedValue(null), cacheSet: vi.fn(), cacheDel: vi.fn() }))

import {
  computeEarnedLevel,
  computeMemberLevel,
  getCurrentLevel,
  getMemberLevel,
  submitMissionCompletion,
} from './missions'
import { checkVouchReceived, checkRarePizzaBox, applyLevelGate } from './level-gate'
import { prisma } from './db'
import { fetchMemberIdByDiscordId } from './sheets/member-repository'
import { getNFTContracts } from './nft-config'
import { holdsNFTOfContract } from './nft'
import { getEvmWalletsForMember } from './wallet-lookup'

const mockFn = (f: unknown) => f as ReturnType<typeof vi.fn>

// One mission per level 1..7, id = level.
const MISSIONS = [1, 2, 3, 4, 5, 6, 7].map((l) => ({ id: l, level: l }))
const ids = (...n: number[]) => new Set(n)
const NONE = { vouch: null, box: null } as const
const VOUCH = { vouch: 'yes', box: 'no' } as const
const BOX_ONLY = { vouch: 'no', box: 'yes' } as const
const BOTH = { vouch: 'yes', box: 'yes' } as const
const lv = (approved: Set<number>, access: Parameters<typeof computeMemberLevel>[3]) =>
  computeMemberLevel(MISSIONS, approved, new Set(), access).level

describe('level computation', () => {
  it('earns levels in order: higher-level missions done early do not count', () => {
    expect(computeEarnedLevel(MISSIONS, ids(6, 7))).toBe(1)
    expect(computeEarnedLevel(MISSIONS, ids(1, 2, 3, 6, 7))).toBe(4) // 4 and 5 missing
    expect(computeEarnedLevel(MISSIONS, ids(1, 2, 3, 4, 5, 6, 7))).toBe(8)
  })

  it('out of order: finishing 4 and 5 first, then 1-3, completes through 5 only at the end', () => {
    expect(lv(ids(4, 5), BOTH)).toBe(1)
    expect(lv(ids(1, 2, 3, 4, 5), BOTH)).toBe(6)
  })

  it('levels 1-3 never need a vouch or a box', () => {
    expect(lv(ids(1, 2), NONE)).toBe(3)
    expect(lv(ids(1), { vouch: 'no', box: 'no' })).toBe(2)
  })

  it('no vouch: stuck at 3 even with a box and every mission done', () => {
    expect(lv(ids(1, 2, 3, 4, 5, 6, 7), BOX_ONLY)).toBe(3)
    expect(lv(ids(1, 2, 3, 4, 5, 6, 7), { vouch: 'no', box: 'no' })).toBe(3)
  })

  it('a vouch alone reaches level 4 but not 5 (that needs a Rare Pizza Box)', () => {
    expect(lv(ids(1, 2, 3), VOUCH)).toBe(4)
    expect(lv(ids(1, 2, 3, 4), VOUCH)).toBe(4)
    expect(lv(ids(1, 2, 3, 4, 5, 6, 7), VOUCH)).toBe(4)
  })

  it('vouch and box together: the full earned level', () => {
    expect(lv(ids(1, 2, 3, 4), BOTH)).toBe(5)
    expect(lv(ids(1, 2, 3, 4, 5, 6, 7), BOTH)).toBe(8)
  })

  it('a failed lookup never awards the gated level', () => {
    expect(lv(ids(1, 2, 3, 4), { vouch: 'error', box: 'yes' })).toBe(3)
    expect(lv(ids(1, 2, 3, 4), { vouch: 'yes', box: 'error' })).toBe(4)
    const r = computeMemberLevel(MISSIONS, ids(1, 2, 3, 4), new Set(), { vouch: 'yes', box: 'error' })
    expect(r.gate.box).toBe('unknown')
    expect(r.earnedLevel).toBe(5)
  })

  it('grandfathered: paid a level 3 reward before the gate keeps level 4 without a vouch, but not 5 without a box', () => {
    const access = { vouch: 'no', box: 'no', paidBeforeGate: 3 } as const
    const r = computeMemberLevel(MISSIONS, ids(1, 2, 3, 4), new Set([1, 2, 3]), access)
    expect(r.gate.vouch).toBe('grandfathered')
    expect(r.level).toBe(4)
  })

  it('grandfathered: paid a level 4 reward before the gate keeps level 5 with neither', () => {
    const r = computeMemberLevel(MISSIONS, ids(1, 2, 3, 4), new Set([1, 2, 3, 4]), { vouch: 'no', box: 'no', paidBeforeGate: 4 })
    expect(r.level).toBe(5)
  })

  it('applyLevelGate leaves levels below the gates alone', () => {
    expect(applyLevelGate(3, { vouch: 'missing', box: 'missing' })).toBe(3)
    expect(applyLevelGate(4, { vouch: 'ok', box: 'missing' })).toBe(4)
  })
})

describe('getMemberLevel (lookups)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFn(prisma.mission.findMany).mockResolvedValue(MISSIONS)
    mockFn(prisma.transaction.findMany).mockResolvedValue([])
    mockFn(prisma.missionCompletion.findMany).mockResolvedValue([1, 2, 3, 4].map((missionId) => ({ missionId })))
    mockFn(fetchMemberIdByDiscordId).mockResolvedValue('m1')
    mockFn(prisma.vouch.count).mockResolvedValue(1)
    mockFn(getEvmWalletsForMember).mockResolvedValue(['0xabc'])
    mockFn(getNFTContracts).mockResolvedValue([{ name: 'Rare Pizza Box', address: '0x1', chain: 'base' }])
    mockFn(holdsNFTOfContract).mockResolvedValue(true)
  })

  it('vouch + box -> level 5', async () => {
    expect(await getCurrentLevel('u')).toBe(5)
  })

  it('does not look anything up below level 4 (no vouch/NFT calls)', async () => {
    mockFn(prisma.missionCompletion.findMany).mockResolvedValue([{ missionId: 1 }])
    expect((await getMemberLevel('u')).level).toBe(2)
    expect(prisma.vouch.count).not.toHaveBeenCalled()
    expect(holdsNFTOfContract).not.toHaveBeenCalled()
  })

  it('NFT lookup error: held at 4 with state unknown, no crash', async () => {
    mockFn(holdsNFTOfContract).mockRejectedValue(new Error('alchemy down'))
    const r = await getMemberLevel('u')
    expect(r.level).toBe(4)
    expect(r.earnedLevel).toBe(5)
    expect(r.gate.box).toBe('unknown')
  })

  it('no box: held at 4 with state missing', async () => {
    mockFn(holdsNFTOfContract).mockResolvedValue(false)
    const r = await getMemberLevel('u')
    expect(r.level).toBe(4)
    expect(r.gate.box).toBe('missing')
  })

  it('no vouch: held at 3', async () => {
    mockFn(prisma.vouch.count).mockResolvedValue(0)
    const r = await getMemberLevel('u')
    expect(r.level).toBe(3)
    expect(r.gate.vouch).toBe('missing')
  })

  it('vouch lookup error: held at 3, state unknown', async () => {
    mockFn(prisma.vouch.count).mockRejectedValue(new Error('db'))
    const r = await getMemberLevel('u')
    expect(r.level).toBe(3)
    expect(r.gate.vouch).toBe('unknown')
  })

  it('no demotion: a member paid for level 4 before the gate keeps level 5 with no vouch and no box', async () => {
    mockFn(prisma.vouch.count).mockResolvedValue(0)
    mockFn(holdsNFTOfContract).mockResolvedValue(false)
    // The ledger query is filtered by createdAt < gate start; the mock returns the pre-gate rows.
    mockFn(prisma.transaction.findMany).mockResolvedValue([1, 2, 3, 4].map((level) => ({ metadata: { level } })))
    const r = await getMemberLevel('u')
    expect(r.level).toBe(5)
    expect(r.gate).toEqual({ vouch: 'grandfathered', box: 'grandfathered' })
    const where = mockFn(prisma.transaction.findMany).mock.calls.find((c) => c[0]?.where?.createdAt)?.[0].where
    expect(where.createdAt.lt).toBeInstanceOf(Date)
  })

  it('full mode looks both requirements up even below their levels (for the progress display)', async () => {
    mockFn(prisma.missionCompletion.findMany).mockResolvedValue([{ missionId: 1 }])
    const r = await getMemberLevel('u', { full: true })
    expect(r.level).toBe(2)
    expect(r.gate).toEqual({ vouch: 'ok', box: 'ok' })
  })
})

describe('lookups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFn(fetchMemberIdByDiscordId).mockResolvedValue('m1')
  })

  it('vouch received counts PizzaDAO-native vouches from other members only', async () => {
    mockFn(prisma.vouch.count).mockResolvedValue(2)
    expect(await checkVouchReceived('u')).toBe('yes')
    expect(prisma.vouch.count).toHaveBeenCalledWith({
      where: { followeeId: 'm1', followerId: { not: 'm1' }, source: 'PIZZADAO' },
    })
    mockFn(prisma.vouch.count).mockResolvedValue(0)
    expect(await checkVouchReceived('u')).toBe('no')
  })

  it('vouch lookup: no member row is "no", a failure is "error"', async () => {
    mockFn(fetchMemberIdByDiscordId).mockResolvedValue(null)
    expect(await checkVouchReceived('u')).toBe('no')
    mockFn(fetchMemberIdByDiscordId).mockRejectedValue(new Error('sheet'))
    expect(await checkVouchReceived('u')).toBe('error')
  })

  it('box lookup: no wallets is "no", no contract configured is "error"', async () => {
    mockFn(getEvmWalletsForMember).mockResolvedValue([])
    expect(await checkRarePizzaBox('u')).toBe('no')
    mockFn(getEvmWalletsForMember).mockResolvedValue(['0xabc'])
    mockFn(getNFTContracts).mockResolvedValue([])
    expect(await checkRarePizzaBox('u')).toBe('error')
  })
})

describe('submissions above the current level', () => {
  it('are allowed (no "complete level N first" block) and reviewed normally', async () => {
    vi.clearAllMocks()
    mockFn(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma))
    const L7 = { id: 7, level: 7, index: 0, title: 'Late mission', reward: 1, isActive: true }
    mockFn(prisma.mission.findUnique).mockResolvedValue(L7)
    mockFn(prisma.missionCompletion.findUnique).mockResolvedValue(null)
    mockFn(prisma.missionCompletion.create).mockImplementation(async ({ data }: { data: object }) => ({ id: 9, ...data, mission: L7 }))
    const c = await submitMissionCompletion('brand-new-member', 7, 'https://x.com/p')
    expect(c.status).toBe('PENDING')
    // The old gate looked the member's level up first.
    expect(prisma.mission.findMany).not.toHaveBeenCalled()
  })
})
