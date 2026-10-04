// /pep economy reads must never be served from a shared CDN copy: a bounty
// posted (or a job paid, an item bought...) has to show up on the very next
// refetch. Before this suite, GET /api/bounties and /api/economy/leaderboard
// sent `public, s-maxage=300, stale-while-revalidate=1800`, so a just-posted
// bounty could stay invisible for ~35 minutes.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/lib/session', () => ({
  getSession: vi.fn(async () => ({ discordId: 'user-1' })),
}))

vi.mock('@/app/lib/bounties', () => ({
  getAllBounties: vi.fn(async () => [
    {
      id: 1, description: 'Flyer', link: null, reward: 50, createdBy: 'user-1', claimedBy: null,
      status: 'OPEN', crewId: null, createdAt: new Date('2026-01-01T00:00:00Z'), _count: { comments: 0 },
    },
  ]),
  createBounty: vi.fn(),
  resolveBountyCrewId: vi.fn(),
  getCrewLabelMap: vi.fn(async () => new Map()),
  getBountyComments: vi.fn(async () => []),
  addBountyComment: vi.fn(),
  deleteBountyComment: vi.fn(),
}))

vi.mock('@/app/lib/economy', () => ({
  requireOnboarded: vi.fn(async () => undefined),
  getBalance: vi.fn(async () => ({ balance: 4200 })),
  getLeaderboard: vi.fn(async () => [{ userId: 'user-1', balance: 4200 }]),
  formatCurrency: (n: number) => `${n} $PEP`,
}))

vi.mock('@/app/lib/sheets/member-repository', () => ({
  getSheetData: vi.fn(async () => ({ discordToMember: new Map([['user-1', '42']]) })),
}))

vi.mock('@/app/lib/jobs', () => ({
  getDailyJobs: vi.fn(async () => ({ jobs: [{ id: 1, description: 'Do it', type: null, assignees: [] }], resetAt: new Date() })),
  getCompletedJobsToday: vi.fn(async () => []),
  JOB_REWARD_AMOUNT: 50,
}))

vi.mock('@/app/lib/shop', () => ({
  getShopItems: vi.fn(async () => [{ id: 1, name: 'Hat', description: null, price: 69, quantity: -1 }]),
  getInventory: vi.fn(async () => [
    { itemId: 1, quantity: 1, item: { id: 1, name: 'Hat', description: null, image: null, isCollectible: false } },
  ]),
}))

vi.mock('@/app/lib/transactions', () => ({
  getTransactionHistory: vi.fn(async () => ({ transactions: [], total: 0 })),
}))

import { GET as bountiesGET } from './bounties/route'
import { GET as bountyCommentsGET } from './bounties/[bountyId]/comments/route'
import { GET as leaderboardGET } from './economy/leaderboard/route'
import { GET as balanceGET } from './economy/balance/route'
import { GET as historyGET } from './economy/history/route'
import { GET as jobsGET } from './jobs/route'
import { GET as shopGET } from './shop/route'
import { GET as inventoryGET } from './inventory/route'

const req = (path: string) => new NextRequest(new URL(path, 'http://localhost:3000'))

function expectNoStore(res: Response) {
  const cc = res.headers.get('cache-control') ?? ''
  expect(cc).toContain('no-store')
  expect(cc).toContain('private')
  expect(cc).not.toMatch(/public|s-maxage|stale-while-revalidate/)
}

describe('/pep economy GET routes are never CDN-cached', () => {
  beforeEach(() => vi.clearAllMocks())

  const cases: Array<[string, () => Promise<Response>]> = [
    ['GET /api/bounties', () => bountiesGET(req('/api/bounties'))],
    ['GET /api/bounties?crewId=ops', () => bountiesGET(req('/api/bounties?crewId=ops'))],
    ['GET /api/bounties/1/comments', () => bountyCommentsGET(req('/api/bounties/1/comments'), { params: Promise.resolve({ bountyId: '1' }) })],
    ['GET /api/economy/leaderboard', () => leaderboardGET()],
    ['GET /api/economy/balance', () => balanceGET()],
    ['GET /api/economy/history', () => historyGET(req('/api/economy/history'))],
    ['GET /api/jobs', () => jobsGET()],
    ['GET /api/shop', () => shopGET()],
    ['GET /api/inventory', () => inventoryGET()],
  ]

  for (const [name, call] of cases) {
    it(`${name} sends Cache-Control: private, no-store`, async () => {
      const res = await call()
      expect(res.status).toBe(200)
      expectNoStore(res)
    })
  }

  it('a failing GET /api/bounties is not cached either', async () => {
    const { getAllBounties } = await import('@/app/lib/bounties')
    ;(getAllBounties as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('db down'))
    const res = await bountiesGET(req('/api/bounties'))
    expect(res.status).toBe(500)
    expectNoStore(res)
  })
})
