// jalapeno-82565 — crew-tagged bounties.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createBounty,
  getAllBounties,
  getOpenBounties,
  getCrewLabelMap,
  resolveBountyCrewId,
} from './bounties'
import { prisma } from './db'

vi.mock('./db')
vi.mock('./economy', () => ({
  getOrCreateEconomy: vi.fn(),
  debitInTx: vi.fn(),
  creditInTx: vi.fn(),
}))
vi.mock('./notifications', () => ({
  notifyBountyClaimed: vi.fn().mockResolvedValue(undefined),
  notifyBountyCompleted: vi.fn().mockResolvedValue(undefined),
  notifyBountyComment: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./transactions', () => ({
  logTransaction: vi.fn().mockResolvedValue({}),
}))
vi.mock('./crew-mappings', () => ({
  getCrewMappings: vi.fn(),
}))

import { getOrCreateEconomy, debitInTx } from './economy'
import { getCrewMappings } from './crew-mappings'

const mockFn = (f: unknown) => f as ReturnType<typeof vi.fn>

const CREWS = {
  cached: true,
  crews: [
    { id: 'ops', label: 'Ops', turtles: [] },
    { id: 'biz_dev', label: 'Biz Dev', turtles: [] },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFn(getCrewMappings).mockResolvedValue(CREWS)
  mockFn(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma))
})

describe('resolveBountyCrewId', () => {
  it('returns null for a general bounty', async () => {
    expect(await resolveBountyCrewId(undefined)).toBeNull()
    expect(await resolveBountyCrewId(null)).toBeNull()
    expect(await resolveBountyCrewId('')).toBeNull()
    expect(getCrewMappings).not.toHaveBeenCalled()
  })

  it('accepts a known crew id', async () => {
    expect(await resolveBountyCrewId('ops')).toBe('ops')
  })

  it('normalizes a crew label to its slug', async () => {
    expect(await resolveBountyCrewId('Biz Dev')).toBe('biz_dev')
  })

  it('rejects an unknown crew', async () => {
    await expect(resolveBountyCrewId('pirates')).rejects.toThrow('Unknown crew: pirates')
  })

  it('rejects non-string and garbage input', async () => {
    await expect(resolveBountyCrewId(42)).rejects.toThrow('crewId must be a string')
    await expect(resolveBountyCrewId('!!!')).rejects.toThrow('Invalid crewId')
  })
})

describe('createBounty with a crew', () => {
  it('stores the crew id on the bounty', async () => {
    mockFn(getOrCreateEconomy).mockResolvedValue({ id: 'creator-1', wallet: 500 })
    mockFn(debitInTx).mockResolvedValue(undefined)
    mockFn(prisma.bounty.create).mockResolvedValue({ id: 11, crewId: 'ops', status: 'OPEN' })

    const bounty = await createBounty('creator-1', 'Run the ops call', 100, undefined, 'ops')

    expect(prisma.bounty.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ crewId: 'ops', createdBy: 'creator-1', reward: 100 }),
    })
    expect(bounty.crewId).toBe('ops')
  })

  it('stores null when no crew is given', async () => {
    mockFn(getOrCreateEconomy).mockResolvedValue({ id: 'creator-1', wallet: 500 })
    mockFn(prisma.bounty.create).mockResolvedValue({ id: 12, crewId: null, status: 'OPEN' })

    await createBounty('creator-1', 'General task', 50)

    expect(prisma.bounty.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ crewId: null }),
    })
  })
})

describe('bounty listing by crew', () => {
  it('getAllBounties filters by crew when given', async () => {
    mockFn(prisma.bounty.findMany).mockResolvedValue([])
    await getAllBounties({ crewId: 'Ops' })
    expect(prisma.bounty.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ['OPEN', 'CLAIMED'] }, crewId: 'ops' },
      }),
    )
  })

  it('getAllBounties returns every crew when no filter is given', async () => {
    mockFn(prisma.bounty.findMany).mockResolvedValue([])
    await getAllBounties()
    expect(prisma.bounty.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { in: ['OPEN', 'CLAIMED'] } } }),
    )
  })

  it('getOpenBounties filters by crew when given', async () => {
    mockFn(prisma.bounty.findMany).mockResolvedValue([])
    await getOpenBounties({ crewId: 'biz_dev' })
    expect(prisma.bounty.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'OPEN', crewId: 'biz_dev' } }),
    )
  })
})

describe('getCrewLabelMap', () => {
  it('maps crew ids to labels', async () => {
    const map = await getCrewLabelMap()
    expect(map.get('biz_dev')).toBe('Biz Dev')
  })

  it('fails soft when crew mappings are unavailable', async () => {
    mockFn(getCrewMappings).mockRejectedValue(new Error('sheet down'))
    const map = await getCrewLabelMap()
    expect(map.size).toBe(0)
  })
})
