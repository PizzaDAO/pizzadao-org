// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/app/lib/calls/review-audit', () => ({ recordCallReviewEvent: vi.fn(async () => undefined) }))

import { prisma } from '@/app/lib/db'
import { dropAutoHeld } from './hold'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>
const filter = { excludedCrewIds: [], excludedCrewLabelTerms: [], blockedTerms: [], ownerOnlyTerms: ['sensitive'], ownerOnlyCrewIds: ['crew_owner'] }
const empty = { ...filter, ownerOnlyTerms: [], ownerOnlyCrewIds: [] }

beforeEach(() => vi.clearAllMocks())

describe('dropAutoHeld (a capo list)', () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  it('drops the calls the owner-only filter holds', async () => {
    m(db.callRecording.findMany).mockResolvedValue([
      { id: 'a', crewId: 'crew_x', title: 'Fine', summary: 'ok', actionItems: [], chapters: [] },
      { id: 'b', crewId: 'crew_x', title: 'Sensitive plans', summary: '', actionItems: [], chapters: [] },
      { id: 'c', crewId: 'crew_owner', title: 'Fine', summary: 'ok', actionItems: [], chapters: [] },
    ])
    expect(await dropAutoHeld(rows, filter)).toEqual([{ id: 'a' }])
  })
  it('skips the query when the filter has no owner-only entries', async () => {
    expect(await dropAutoHeld(rows, empty)).toEqual(rows)
    expect(db.callRecording.findMany).not.toHaveBeenCalled()
  })
  it('hides everything when the filter could not be read', async () => {
    expect(await dropAutoHeld(rows, null)).toEqual([])
  })
})
