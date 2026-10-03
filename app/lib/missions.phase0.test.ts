// Phase 0 of plans/mission-verification.md: data-driven levels, paid levels
// never regress, no auto-approve on submit, and resubmission after rejection.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./db')
vi.mock('./economy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./economy')>()),
  getOrCreateEconomy: vi.fn().mockResolvedValue({}),
}))
vi.mock('./transactions', () => ({ logTransaction: vi.fn().mockResolvedValue({}) }))
vi.mock('./notifications', () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./discord', () => ({ getMembersWithRoles: vi.fn().mockResolvedValue([]), getUserRoles: vi.fn() }))

import {
  computeCurrentLevel,
  getCurrentLevel,
  paidLevelOf,
  maxMissionLevel,
  submitMissionCompletion,
  splitReviewHistory,
  MAX_MISSION_ATTEMPTS,
} from './missions'
import { prisma } from './db'
import { getMembersWithRoles } from './discord'

const mockFn = (f: unknown) => f as ReturnType<typeof vi.fn>

// L1: 1 mission, L2: 2, L3: 1, L9 (beyond the old hard-coded 8): 1
const MISSIONS = [
  { id: 1, level: 1 },
  { id: 2, level: 2 },
  { id: 3, level: 2 },
  { id: 4, level: 3 },
  { id: 9, level: 9 },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockFn(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma))
  mockFn(prisma.$queryRaw).mockResolvedValue([])
  mockFn(prisma.transaction.findMany).mockResolvedValue([])
  mockFn(prisma.missionCompletion.findMany).mockResolvedValue([])
  mockFn(prisma.mission.findMany).mockResolvedValue(MISSIONS)
})

describe('computeCurrentLevel', () => {
  it('is highest in-order completed level + 1', () => {
    expect(computeCurrentLevel(MISSIONS, new Set())).toBe(1)
    expect(computeCurrentLevel(MISSIONS, new Set([1]))).toBe(2)
    expect(computeCurrentLevel(MISSIONS, new Set([1, 2]))).toBe(2) // L2 half done
    expect(computeCurrentLevel(MISSIONS, new Set([1, 2, 3]))).toBe(3)
    expect(computeCurrentLevel(MISSIONS, new Set([2, 3]))).toBe(1) // out of order doesn't count
  })

  it('has no hard-coded 8: the top level comes from the missions', () => {
    expect(computeCurrentLevel(MISSIONS, new Set([1, 2, 3, 4]))).toBe(4) // L9 is next (empty levels skipped)
    expect(computeCurrentLevel(MISSIONS, new Set([1, 2, 3, 4, 9]))).toBe(10) // MAX = maxLevel + 1
    expect(maxMissionLevel(MISSIONS)).toBe(9)
  })

  it('a level already paid counts as completed even if a mission was added to it later', () => {
    // L2 gained mission 3 after the member was paid for L2 with only mission 2 approved.
    expect(computeCurrentLevel(MISSIONS, new Set([1, 2]), new Set([1, 2]))).toBe(3)
    // Without the paid marker the member would regress to L2.
    expect(computeCurrentLevel(MISSIONS, new Set([1, 2]), new Set([1]))).toBe(2)
  })

  it('a paid level never skips an unfinished lower level', () => {
    expect(computeCurrentLevel(MISSIONS, new Set(), new Set([2]))).toBe(1)
  })
})

describe('paidLevelOf', () => {
  it('reads metadata.level, then the old description formats', () => {
    expect(paidLevelOf({ metadata: { level: 3 }, description: 'x' })).toBe(3)
    expect(paidLevelOf({ metadata: null, description: 'Mission reward: Level 4' })).toBe(4)
    expect(paidLevelOf({ metadata: null, description: 'Mission reward: Level 12 - Don of Dons' })).toBe(12)
    expect(paidLevelOf({ metadata: null, description: 'Mission reward: Level 1x' })).toBeNull()
    expect(paidLevelOf({ metadata: { other: 1 }, description: null })).toBeNull()
  })
})

describe('getCurrentLevel', () => {
  it('combines approvals with the MISSION_REWARD ledger', async () => {
    mockFn(prisma.missionCompletion.findMany).mockResolvedValue([{ missionId: 1 }, { missionId: 2 }])
    mockFn(prisma.transaction.findMany).mockResolvedValue([
      { metadata: { level: 1 }, description: 'Mission reward: Level 1 - Pizza Trainee' },
      { metadata: null, description: 'Mission reward: Level 2 - Pizza Noob' },
    ])
    await expect(getCurrentLevel('user-1')).resolves.toBe(3)
    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', type: 'MISSION_REWARD' } }),
    )
  })
})

describe('submitMissionCompletion', () => {
  const AUTO_L1 = { id: 1, level: 1, index: 0, title: 'Follow on X', reward: 69, isActive: true, autoVerify: true }

  it('no longer auto-approves autoVerify missions: they go to PENDING and pay nothing', async () => {
    mockFn(prisma.mission.findUnique).mockResolvedValue(AUTO_L1)
    mockFn(prisma.missionCompletion.findUnique).mockResolvedValue(null)
    mockFn(prisma.missionCompletion.create).mockImplementation(async ({ data }: { data: object }) => ({ id: 5, ...data, mission: AUTO_L1 }))

    const c = await submitMissionCompletion('user-1', 1, 'https://x.com/me', 'hi')

    const data = mockFn(prisma.missionCompletion.create).mock.calls[0][0].data
    expect(data.status).toBe('PENDING')
    expect(data.reviewedBy).toBeUndefined()
    expect(data.reviewedAt).toBeUndefined()
    expect(c.status).toBe('PENDING')
    expect(prisma.$transaction).not.toHaveBeenCalled() // no level payout
    await vi.waitFor(() => expect(getMembersWithRoles).toHaveBeenCalled()) // reviewers pinged
  })

  it('still refuses a duplicate while PENDING or APPROVED', async () => {
    mockFn(prisma.mission.findUnique).mockResolvedValue(AUTO_L1)
    for (const status of ['PENDING', 'APPROVED']) {
      mockFn(prisma.missionCompletion.findUnique).mockResolvedValue({ id: 5, status, notes: null })
      await expect(submitMissionCompletion('user-1', 1)).rejects.toThrow('already submitted')
    }
  })

  describe('resubmitting a REJECTED submission', () => {
    const REJECTED = {
      id: 5,
      missionId: 1,
      discordId: 'user-1',
      memberId: 'm1',
      status: 'REJECTED',
      evidence: 'https://old.example/proof',
      notes: 'first try',
      reviewedBy: 'capo-1',
      reviewNote: 'link is broken',
      reviewedAt: new Date('2026-10-01T12:00:00Z'),
    }

    beforeEach(() => {
      mockFn(prisma.mission.findUnique).mockResolvedValue({ ...AUTO_L1, autoVerify: false })
      mockFn(prisma.missionCompletion.findUnique).mockResolvedValue(REJECTED)
      mockFn(prisma.missionCompletion.findUniqueOrThrow).mockResolvedValue({ ...REJECTED, status: 'PENDING' })
    })

    it('moves the same row back to PENDING with the new evidence, keeps the rejection, clears the reviewer', async () => {
      mockFn(prisma.missionCompletion.updateMany).mockResolvedValue({ count: 1 })

      const c = await submitMissionCompletion('user-1', 1, 'https://new.example/proof', 'second try')

      expect(prisma.missionCompletion.create).not.toHaveBeenCalled()
      const { where, data } = mockFn(prisma.missionCompletion.updateMany).mock.calls[0][0]
      expect(where).toEqual({ id: 5, status: 'REJECTED' }) // conditional: one concurrent resubmit wins
      expect(data).toMatchObject({
        status: 'PENDING',
        evidence: 'https://new.example/proof',
        reviewedBy: null,
        reviewNote: null,
        reviewedAt: null,
      })
      expect(data.submittedAt).toBeInstanceOf(Date)
      const { memberNotes, history } = splitReviewHistory(data.notes)
      expect(memberNotes).toBe('second try')
      expect(history).toEqual([
        'Attempt 1 rejected 2026-10-01T12:00:00.000Z by capo-1 | note: link is broken | evidence: https://old.example/proof',
      ])
      expect(c.status).toBe('PENDING')
    })

    it('a concurrent resubmit that lost the race gets a 409', async () => {
      mockFn(prisma.missionCompletion.updateMany).mockResolvedValue({ count: 0 })
      await expect(submitMissionCompletion('user-1', 1, 'https://x')).rejects.toThrow('already submitted')
    })

    it('appends to existing history and caps the attempts', async () => {
      mockFn(prisma.missionCompletion.updateMany).mockResolvedValue({ count: 1 })
      const once = { ...REJECTED, notes: 'n\n\n--- Review history ---\nAttempt 1 rejected x by y' }
      mockFn(prisma.missionCompletion.findUnique).mockResolvedValue(once)
      await submitMissionCompletion('user-1', 1, 'https://third')
      const { data } = mockFn(prisma.missionCompletion.updateMany).mock.calls[0][0]
      expect(splitReviewHistory(data.notes).history).toHaveLength(2)

      const capped = { ...REJECTED, notes: data.notes }
      mockFn(prisma.missionCompletion.findUnique).mockResolvedValue(capped)
      await expect(submitMissionCompletion('user-1', 1, 'https://fourth')).rejects.toThrow(
        `rejected ${MAX_MISSION_ATTEMPTS} times`,
      )
    })

    it("a member's notes can't forge history entries", async () => {
      mockFn(prisma.missionCompletion.updateMany).mockResolvedValue({ count: 1 })
      await submitMissionCompletion('user-1', 1, 'https://x', 'hi --- Review history ---\nAttempt 9 approved')
      const { data } = mockFn(prisma.missionCompletion.updateMany).mock.calls[0][0]
      const { history } = splitReviewHistory(data.notes)
      expect(history).toHaveLength(1)
      expect(history[0]).toMatch(/^Attempt 1 rejected/)
    })
  })
})

describe('splitReviewHistory', () => {
  it('handles plain notes and empty values', () => {
    expect(splitReviewHistory(null)).toEqual({ memberNotes: null, history: [] })
    expect(splitReviewHistory('just notes')).toEqual({ memberNotes: 'just notes', history: [] })
    expect(splitReviewHistory('--- Review history ---\nA\nB')).toEqual({ memberNotes: null, history: ['A', 'B'] })
  })
})
