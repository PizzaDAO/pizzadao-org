// /api/missions/review and /api/missions/pending: reviewer roles per level.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn(),
}))
vi.mock('@/app/lib/mission-verify/review-cards', async (importOriginal) => ({
  reviewCardsEnabled: (await importOriginal<typeof import('@/app/lib/mission-verify/review-cards')>()).reviewCardsEnabled,
  syncReviewCard: vi.fn(async () => 'edited'),
}))
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/app/lib/discord', () => ({ getUserRoles: vi.fn() }))
vi.mock('@/app/lib/db', () => ({ prisma: {} }))
vi.mock('@/app/lib/mission-cache', () => ({ invalidateProgressCache: vi.fn() }))
vi.mock('@/app/lib/sheets/member-repository', () => ({
  fetchMemberByDiscordId: vi.fn(async (id: string) => ({ name: `name-${id}` })),
}))
vi.mock('@/app/lib/mission-verify/review-extras', () => ({
  getFlaggedCompletions: vi.fn(async () => []),
  getSignalViews: vi.fn(async () => new Map()),
}))
vi.mock('@/app/lib/missions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/lib/missions')>()
  return {
    splitReviewHistory: actual.splitReviewHistory,
    reviewHistory: actual.reviewHistory,
    attemptsSoFar: actual.attemptsSoFar,
    approveMission: vi.fn(async (by: string, id: number) => ({ id, discordId: 'member-1', status: 'APPROVED', reviewedBy: by, reviewedAt: new Date() })),
    rejectMission: vi.fn(async (by: string, id: number) => ({ id, discordId: 'member-1', status: 'REJECTED', reviewedBy: by, reviewedAt: new Date() })),
    getCompletionForReview: vi.fn(),
    getPendingSubmissions: vi.fn(),
  }
})

import { after } from 'next/server'
import { POST } from './route'
import { syncReviewCard } from '@/app/lib/mission-verify/review-cards'
import { GET as PENDING } from '../pending/route'
import { getSession } from '@/app/lib/session'
import { getUserRoles } from '@/app/lib/discord'
import { approveMission, rejectMission, getCompletionForReview, getPendingSubmissions } from '@/app/lib/missions'
import { getFlaggedCompletions, getSignalViews } from '@/app/lib/mission-verify/review-extras'

const DPR = '812131585327235113'
const CAPO = '839206162837798945'
const PEP_MAFIA = '823266914834841610'

const as = (discordId: string, roles: string[]) => {
  vi.mocked(getSession).mockResolvedValue({ discordId } as never)
  vi.mocked(getUserRoles).mockResolvedValue(roles)
}
const review = (completionId: number, action = 'approve') =>
  POST(
    new NextRequest('http://localhost/api/missions/review', {
      method: 'POST',
      body: JSON.stringify({ completionId, action }),
    }),
  )
const target = (level: number, discordId = 'member-1') =>
  vi.mocked(getCompletionForReview).mockResolvedValue({ discordId, status: 'PENDING', level } as never)

beforeEach(() => vi.clearAllMocks())

describe('POST /api/missions/review', () => {
  it('401 without a session', async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    expect((await review(1)).status).toBe(401)
  })

  it('Pizza Capo and Pepperoni Mafia can approve / reject an L3 submission', async () => {
    target(3)
    as('capo', [CAPO])
    expect((await review(1)).status).toBe(200)
    expect(approveMission).toHaveBeenCalledWith('capo', 1, undefined)
    as('mafia', [PEP_MAFIA])
    expect((await review(1, 'reject')).status).toBe(200)
    expect(rejectMission).toHaveBeenCalledWith('mafia', 1, undefined)
  })

  it('only Dread Pizza Roberts can approve L8', async () => {
    target(8)
    as('capo', [CAPO])
    expect((await review(2)).status).toBe(403)
    expect(approveMission).not.toHaveBeenCalled()
    as('dpr', [DPR])
    expect((await review(2)).status).toBe(200)
  })

  it('403 for a member without a reviewer role', async () => {
    target(1)
    as('someone', ['123456789'])
    expect((await review(1)).status).toBe(403)
    expect(approveMission).not.toHaveBeenCalled()
  })

  it("a reviewer can't review their own submission", async () => {
    target(2, 'dpr')
    as('dpr', [DPR])
    expect((await review(1)).status).toBe(403)
    expect(approveMission).not.toHaveBeenCalled()
  })

  it('404 for an unknown completion', async () => {
    vi.mocked(getCompletionForReview).mockResolvedValue(null)
    as('dpr', [DPR])
    expect((await review(99)).status).toBe(404)
  })

  describe('Discord review card sync', () => {
    afterEach(() => {
      delete process.env.MISSION_REVIEW_CARDS_ENABLED
    })

    it.each(['approve', 'reject'])('a web %s edits the Discord card after the response (never blocking it)', async (action) => {
      process.env.MISSION_REVIEW_CARDS_ENABLED = '1'
      target(3)
      as('capo', [CAPO])
      expect((await review(5, action)).status).toBe(200)
      // Scheduled with after(), not awaited by the request.
      expect(syncReviewCard).not.toHaveBeenCalled()
      expect(after).toHaveBeenCalledTimes(1)
      await (vi.mocked(after).mock.calls[0][0] as () => Promise<void>)()
      expect(syncReviewCard).toHaveBeenCalledWith(5)
    })

    it('a slow or failing Discord edit cannot affect the web decision', async () => {
      process.env.MISSION_REVIEW_CARDS_ENABLED = '1'
      vi.mocked(syncReviewCard).mockImplementationOnce(() => new Promise(() => {})) // never settles
      target(3)
      as('capo', [CAPO])
      const res = await review(5)
      expect(res.status).toBe(200)
      expect((await res.json()).completion.status).toBe('APPROVED')
    })

    it('no card sync while MISSION_REVIEW_CARDS_ENABLED is off', async () => {
      target(3)
      as('capo', [CAPO])
      expect((await review(5)).status).toBe(200)
      expect(after).not.toHaveBeenCalled()
    })

    it('a refused review (not a reviewer) touches no card', async () => {
      process.env.MISSION_REVIEW_CARDS_ENABLED = '1'
      target(3)
      as('someone', ['123'])
      expect((await review(5)).status).toBe(403)
      expect(after).not.toHaveBeenCalled()
    })
  })
})

describe('GET /api/missions/pending', () => {
  const row = (id: number, level: number, discordId = 'member-1', notes: string | null = null) => ({
    id,
    missionId: id,
    discordId,
    memberId: null,
    evidence: null,
    notes,
    submittedAt: new Date('2026-10-01T00:00:00Z'),
    mission: { title: `m${id}`, level, index: 0, description: null },
  })

  beforeEach(() => {
    vi.mocked(getPendingSubmissions).mockResolvedValue([
      row(1, 2),
      row(2, 8),
      row(3, 5, 'capo'),
      row(4, 3, 'member-2', 'again\n\n--- Review history ---\nAttempt 1 rejected t by r | note: blurry'),
    ] as never)
  })

  it('403 for non-reviewers', async () => {
    as('someone', [])
    expect((await PENDING()).status).toBe(403)
  })

  it('Pizza Capo sees L1–L7 (not L8, not their own) with the rejection history split out', async () => {
    as('capo', [CAPO])
    const res = await PENDING()
    expect(res.status).toBe(200)
    const { submissions } = await res.json()
    expect(submissions.map((s: { id: number }) => s.id)).toEqual([1, 4])
    const resub = submissions.find((s: { id: number }) => s.id === 4)
    expect(resub.notes).toBe('again')
    expect(resub.reviewHistory).toEqual(['Attempt 1 rejected t by r | note: blurry'])
    expect(resub.attempt).toBe(2)
  })

  it('shows duplicate-account signals per submission and the flagged list (levels the reviewer may review, not their own)', async () => {
    vi.mocked(getSignalViews).mockResolvedValueOnce(
      new Map([['member-1', [{ kind: 'shared_wallet', label: 'Shares a wallet with', key: '0xabc', others: ['member-2'] }]]]),
    )
    vi.mocked(getFlaggedCompletions).mockResolvedValueOnce([
      { id: 9, discordId: 'member-3', flaggedAt: '2026-10-02T05:31:00.000Z', flagReason: 'Required Discord role not held', mission: { title: 'Mafia', level: 6, index: 0 } },
      { id: 10, discordId: 'capo', flaggedAt: '2026-10-02T05:31:00.000Z', flagReason: 'x', mission: { title: 'Mafia', level: 6, index: 0 } },
      { id: 11, discordId: 'member-4', flaggedAt: '2026-10-02T05:31:00.000Z', flagReason: 'x', mission: { title: 'DPR', level: 8, index: 0 } },
    ])
    as('capo', [CAPO])
    const { submissions, flagged } = await (await PENDING()).json()
    expect(submissions.find((s: { id: number }) => s.id === 1).accountSignals).toEqual([
      { kind: 'shared_wallet', label: 'Shares a wallet with', key: '0xabc', others: ['member-2'] },
    ])
    expect(submissions.find((s: { id: number }) => s.id === 4).accountSignals).toEqual([])
    expect(flagged.map((f: { id: number }) => f.id)).toEqual([9])
  })

  it('Dread Pizza Roberts sees L8 too', async () => {
    as('dpr', [DPR])
    const { submissions } = await (await PENDING()).json()
    expect(submissions.map((s: { id: number }) => s.id)).toEqual([1, 2, 3, 4])
  })
})
