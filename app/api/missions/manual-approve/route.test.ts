// /api/missions/manual-approve: permission matrix, idempotency, and that it approves through the
// normal approveMission path (which owns the exactly-once reward).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn(),
}))
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/app/lib/discord', () => ({ getUserRoles: vi.fn() }))
vi.mock('@/app/lib/profile-summary-invalidate', () => ({ invalidateProfileSummaryForDiscord: vi.fn(async () => undefined) }))
vi.mock('@/app/lib/mission-cache', () => ({ invalidateProgressCache: vi.fn() }))
vi.mock('@/app/lib/mission-verify/notify', () => ({ announceMissionResults: vi.fn(async () => undefined) }))
vi.mock('@/app/lib/mission-verify/review-cards', () => ({
  reviewCardsEnabled: vi.fn(async () => false),
  syncReviewCard: vi.fn(),
}))
vi.mock('@/app/lib/sheets/member-repository', () => ({
  fetchMemberById: vi.fn(async (id: string) => (id === 'm-target' ? { discordId: '555555' } : id === 'm-self' ? { discordId: '777777' } : null)),
  fetchMemberIdByDiscordId: vi.fn(async () => 'm-target'),
}))
const db = vi.hoisted(() => ({
  appSetting: { findMany: vi.fn(async () => []) },
  mission: { findFirst: vi.fn(), findMany: vi.fn() },
  missionCompletion: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  missionReviewEvent: { create: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock('@/app/lib/db', () => ({ prisma: db }))
vi.mock('@/app/lib/missions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/lib/missions')>()
  return {
    REQUIRED_MISSION_WHERE: actual.REQUIRED_MISSION_WHERE,
    recordReviewEvent: vi.fn(async () => undefined),
    approveMission: vi.fn(async (_by: string, id: number) => ({ id, discordId: '555555', status: 'APPROVED', levelsPaid: [3] })),
  }
})

import { GET, POST } from './route'
import { getSession } from '@/app/lib/session'
import { getUserRoles } from '@/app/lib/discord'
import { approveMission, recordReviewEvent } from '@/app/lib/missions'
import { invalidateProfileSummaryForDiscord } from '@/app/lib/profile-summary-invalidate'
import { invalidateProgressCache } from '@/app/lib/mission-cache'

const DPR = '812131585327235113'
const CAPO = '839206162837798945'
const NOBODY = '1'

const as = (discordId: string, roles: string[]) => {
  vi.mocked(getSession).mockResolvedValue({ discordId } as never)
  vi.mocked(getUserRoles).mockResolvedValue(roles)
}
const post = (body: Record<string, unknown>) =>
  POST(
    new NextRequest('http://localhost/api/missions/manual-approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
const mission = (level: number) => db.mission.findFirst.mockResolvedValue({ id: 9, level })
const row = (status: string | null) =>
  db.missionCompletion.findUnique.mockResolvedValue(status ? { id: 42, status } : null)

beforeEach(() => {
  vi.clearAllMocks()
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db))
  db.missionCompletion.create.mockResolvedValue({ id: 42, status: 'PENDING' })
  db.missionCompletion.updateMany.mockResolvedValue({ count: 1 })
})

const ok = { memberId: 'm-target', missionId: 9, note: 'Verified on the call' }

describe('POST /api/missions/manual-approve', () => {
  it('401 without a session', async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    expect((await post(ok)).status).toBe(401)
  })

  it('requires a note', async () => {
    as('capo', [CAPO])
    mission(3)
    expect((await post({ ...ok, note: '  ' })).status).toBe(400)
    expect((await post({ memberId: 'm-target', missionId: 9 })).status).toBe(400)
    expect(approveMission).not.toHaveBeenCalled()
  })

  it('Pizza Capo approves an L3 mission that was never submitted, through approveMission', async () => {
    as('capo', [CAPO])
    mission(3)
    row(null)
    const res = await post(ok)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, alreadyApproved: false, levelsPaid: [3] })
    expect(db.missionCompletion.create).toHaveBeenCalledTimes(1)
    expect(approveMission).toHaveBeenCalledTimes(1)
    expect(vi.mocked(approveMission).mock.calls[0]).toEqual(['capo', 42, 'Manual approval: Verified on the call', 'manual'])
    // The creation is audited as manual.
    expect(recordReviewEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ via: 'manual', actorId: 'capo' }))
    expect(invalidateProgressCache).toHaveBeenCalledWith('555555')
    expect(invalidateProfileSummaryForDiscord).toHaveBeenCalledWith('555555')
  })

  it('reopens a REJECTED row, then approves it', async () => {
    as('capo', [CAPO])
    mission(3)
    row('REJECTED')
    expect((await post(ok)).status).toBe(200)
    expect(db.missionCompletion.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING' }) }))
    expect(approveMission).toHaveBeenCalledTimes(1)
  })

  it('is a no-op for an already approved mission: no approval, no payout, no cache churn', async () => {
    as('capo', [CAPO])
    mission(3)
    row('APPROVED')
    const res = await post(ok)
    expect(await res.json()).toMatchObject({ success: true, alreadyApproved: true, levelsPaid: [] })
    expect(approveMission).not.toHaveBeenCalled()
    expect(db.missionCompletion.create).not.toHaveBeenCalled()
    expect(invalidateProfileSummaryForDiscord).not.toHaveBeenCalled()
  })

  it('a concurrent approval that wins first still pays nothing from this call', async () => {
    as('capo', [CAPO])
    mission(3)
    db.missionCompletion.findUnique
      .mockResolvedValueOnce({ id: 42, status: 'PENDING' })
      .mockResolvedValueOnce({ status: 'APPROVED' })
    const { ConflictError } = await import('@/app/lib/errors/api-errors')
    vi.mocked(approveMission).mockRejectedValueOnce(new ConflictError('already reviewed'))
    const res = await post(ok)
    expect(await res.json()).toMatchObject({ alreadyApproved: true, levelsPaid: [] })
  })

  describe('permission matrix', () => {
    it('refuses someone with no reviewer role (L3)', async () => {
      as(NOBODY, [])
      mission(3)
      row(null)
      expect((await post(ok)).status).toBe(403)
      expect(approveMission).not.toHaveBeenCalled()
      expect(db.missionCompletion.create).not.toHaveBeenCalled()
    })

    it('Pizza Capo cannot approve an L8 mission', async () => {
      as('capo', [CAPO])
      mission(8)
      row(null)
      expect((await post(ok)).status).toBe(403)
      expect(approveMission).not.toHaveBeenCalled()
    })

    it('Dread Pizza Roberts can approve L8', async () => {
      as('dpr', [DPR])
      mission(8)
      row(null)
      expect((await post(ok)).status).toBe(200)
      expect(approveMission).toHaveBeenCalledTimes(1)
    })

    it('nobody approves their own missions, not even DPR (by member id or Discord id)', async () => {
      as('777777', [DPR])
      mission(3)
      row(null)
      expect((await post({ ...ok, memberId: 'm-self' })).status).toBe(403)
      expect((await post({ discordId: '777777', missionId: 9, note: 'my own' })).status).toBe(403)
      expect(approveMission).not.toHaveBeenCalled()
    })

    it('404 for an unknown member, 404 for an unknown or inactive mission', async () => {
      as('dpr', [DPR])
      mission(3)
      expect((await post({ ...ok, memberId: 'nope' })).status).toBe(404)
      db.mission.findFirst.mockResolvedValue(null)
      expect((await post(ok)).status).toBe(404)
    })
  })
})

describe('GET /api/missions/manual-approve (panel data)', () => {
  const get = () => GET(new NextRequest('http://localhost/api/missions/manual-approve?memberId=m-target'))
  const seed = () => {
    db.mission.findMany.mockResolvedValue([
      { id: 1, level: 3, title: 'L3 mission' },
      { id: 2, level: 8, title: 'L8 mission' },
    ])
    db.missionCompletion.findMany.mockResolvedValue([{ id: 5, missionId: 1, status: 'PENDING', events: [] }])
  }

  it('shows a Pizza Capo L1-L7 missions only, with status', async () => {
    as('capo', [CAPO])
    seed()
    const { missions } = await (await get()).json()
    expect(missions).toEqual([{ missionId: 1, level: 3, title: 'L3 mission', status: 'PENDING', manual: false }])
  })

  it('shows DPR both, with NOT_SUBMITTED', async () => {
    as('dpr', [DPR])
    seed()
    const { missions } = await (await get()).json()
    expect(missions.map((m: { level: number; status: string }) => [m.level, m.status])).toEqual([[3, 'PENDING'], [8, 'NOT_SUBMITTED']])
  })

  it('shows nothing to non-reviewers or on your own profile', async () => {
    seed()
    as(NOBODY, [])
    expect((await (await get()).json()).missions).toEqual([])
    as('555555', [DPR])
    expect((await (await get()).json()).missions).toEqual([])
  })
})
