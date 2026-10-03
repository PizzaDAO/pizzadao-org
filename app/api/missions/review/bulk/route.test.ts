// POST /api/missions/review/bulk: the same reviewer rules as a single approve,
// per item (roles per level, L8 = Dread Pizza Roberts only, never your own,
// a manual referral needs a note), plus input limits and rate limiting.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn(),
}))
vi.mock('@/app/lib/mission-verify/review-cards', () => ({ reviewCardsEnabled: () => false, syncReviewCard: vi.fn() }))
vi.mock('@/app/lib/mission-verify/notify', () => ({ announceMissionResults: vi.fn(async () => undefined) }))
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/app/lib/discord', () => ({ getUserRoles: vi.fn() }))
vi.mock('@/app/lib/db', () => ({ prisma: {} }))
vi.mock('@/app/lib/mission-cache', () => ({ invalidateProgressCache: vi.fn() }))
vi.mock('@/app/lib/missions', async () => {
  const { ConflictError } = await import('@/app/lib/errors/api-errors')
  return {
    approveMission: vi.fn(async (by: string, id: number) => {
      if (id === 13) throw new ConflictError('This submission has already been reviewed')
      return { id, discordId: `member-of-${id}`, status: 'APPROVED', levelsPaid: id === 11 ? [3] : [] }
    }),
    getCompletionForReview: vi.fn(),
  }
})

import { after } from 'next/server'
import { POST } from './route'
import { getSession } from '@/app/lib/session'
import { getUserRoles } from '@/app/lib/discord'
import { approveMission, getCompletionForReview } from '@/app/lib/missions'
import { invalidateProgressCache } from '@/app/lib/mission-cache'
import { announceMissionResults } from '@/app/lib/mission-verify/notify'
import { __resetMemoryRateLimits } from '@/app/lib/rate-limit'

const DPR = '812131585327235113'
const CAPO = '839206162837798945'

const TARGETS: Record<number, { discordId: string; status: string; level: number; noteRequired?: boolean }> = {
  11: { discordId: 'member-of-11', status: 'PENDING', level: 2 },
  12: { discordId: 'member-of-12', status: 'PENDING', level: 4 },
  13: { discordId: 'member-of-13', status: 'PENDING', level: 5 }, // loses the race (ConflictError)
  14: { discordId: 'member-of-14', status: 'PENDING', level: 8 }, // DPR only
  15: { discordId: 'capo', status: 'PENDING', level: 2 }, // the reviewer's own
  16: { discordId: 'member-of-16', status: 'APPROVED', level: 2 },
  17: { discordId: 'member-of-17', status: 'PENDING', level: 3, noteRequired: true }, // manual referral
}

const as = (discordId: string, roles: string[]) => {
  vi.mocked(getSession).mockResolvedValue({ discordId } as never)
  vi.mocked(getUserRoles).mockResolvedValue(roles)
}
const bulk = (body: unknown) => POST(new NextRequest('http://localhost/api/missions/review/bulk', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  __resetMemoryRateLimits()
  vi.mocked(getCompletionForReview).mockImplementation(async (id: number) => (TARGETS[id] as never) ?? null)
})

describe('POST /api/missions/review/bulk', () => {
  it('401 without a session', async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    expect((await bulk({ completionIds: [11] })).status).toBe(401)
    expect(approveMission).not.toHaveBeenCalled()
  })

  it('a non-reviewer approves nothing (every item forbidden)', async () => {
    as('someone', ['123456789'])
    const res = await bulk({ completionIds: [11, 12] })
    expect(res.status).toBe(200)
    expect((await res.json()).results).toEqual([
      { id: 11, outcome: 'forbidden' },
      { id: 12, outcome: 'forbidden' },
    ])
    expect(approveMission).not.toHaveBeenCalled()
  })

  it('applies the single-approve rules per item', async () => {
    as('capo', [CAPO])
    const res = await bulk({ completionIds: [11, 12, 13, 14, 15, 16, 17, 99, 11] })
    const json = await res.json()
    expect(json.approved).toBe(2)
    expect(json.results).toEqual([
      { id: 11, outcome: 'approved' },
      { id: 12, outcome: 'approved' },
      { id: 13, outcome: 'already_handled' }, // the race-safe approve said someone else won
      { id: 14, outcome: 'forbidden' }, // L8: Dread Pizza Roberts only
      { id: 15, outcome: 'own_submission' },
      { id: 16, outcome: 'already_handled' },
      { id: 17, outcome: 'note_required' },
      { id: 99, outcome: 'not_found' },
    ])
    expect(vi.mocked(approveMission).mock.calls.map((c) => c[1])).toEqual([11, 12, 13])
    expect(invalidateProgressCache).toHaveBeenCalledWith('member-of-11')
    // Level-up announcements and card syncs run after the response.
    expect(after).toHaveBeenCalledTimes(1)
    await (vi.mocked(after).mock.calls[0][0] as () => Promise<void>)()
    expect(announceMissionResults).toHaveBeenCalledWith({ discordId: 'member-of-11', trigger: 'review', approvedTitles: [], levelsPaid: [3] })
  })

  it('a note covers the manual referral; DPR may approve L8', async () => {
    as('dpr', [DPR])
    const json = await (await bulk({ completionIds: [14, 17], reviewNote: 'Invited @friend, confirmed' })).json()
    expect(json.results).toEqual([
      { id: 14, outcome: 'approved' },
      { id: 17, outcome: 'approved' },
    ])
    expect(approveMission).toHaveBeenCalledWith('dpr', 17, 'Invited @friend, confirmed')
  })

  it('validates the ids (1-50 positive integers)', async () => {
    as('capo', [CAPO])
    for (const completionIds of [undefined, [], ['11'], [0], [1.5], Array.from({ length: 51 }, (_, i) => i + 1)]) {
      expect((await bulk({ completionIds })).status).toBe(400)
    }
    expect(approveMission).not.toHaveBeenCalled()
  })

  it('is rate limited per reviewer', async () => {
    as('capo', [CAPO])
    for (let i = 0; i < 20; i++) expect((await bulk({ completionIds: [16] })).status).toBe(200)
    expect((await bulk({ completionIds: [16] })).status).toBe(429)
  })
})
