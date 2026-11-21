// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/app/lib/calls/review-audit', () => ({ recordCallReviewEvent: vi.fn(async () => undefined) }))
vi.mock('@/app/lib/calls/review-cards', () => ({ queueCallReviewCardSync: vi.fn() }))
vi.mock('@/app/lib/call-tasks/auto-apply', () => ({ queueAutoApply: vi.fn() }))

import { prisma } from '@/app/lib/db'
import { queueAutoApply } from '@/app/lib/call-tasks/auto-apply'
import { dropAutoHeld, releaseHold, setHold } from './hold'

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

describe('releasing a hold', () => {
  it('queues the auto-apply pass for the call\'s action items; holding does not', async () => {
    m(db.callRecording.updateMany).mockResolvedValue({ count: 1 })
    expect(await setHold('rec1', 'owner', null)).toBe('ok')
    expect(queueAutoApply).not.toHaveBeenCalled()
    expect(await releaseHold('rec1', 'owner')).toBe('ok')
    expect(queueAutoApply).toHaveBeenCalledWith('rec1')
  })
  it('nothing is queued when the call was not held', async () => {
    m(db.callRecording.updateMany).mockResolvedValue({ count: 0 })
    m(db.callRecording.findUnique).mockResolvedValue({ id: 'rec1' })
    expect(await releaseHold('rec1', 'owner')).toBe('not-held')
    expect(queueAutoApply).not.toHaveBeenCalled()
  })
})
