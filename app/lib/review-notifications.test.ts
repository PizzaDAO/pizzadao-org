// @vitest-environment node
// "Mission Needs Review" pings: metadata on create, matching (new + legacy), auto-clear on
// approve / reject / release, and the stale-backlog plan used by the cleanup script.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./db')
vi.mock('./economy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./economy')>()),
  getOrCreateEconomy: vi.fn().mockResolvedValue({}),
}))
vi.mock('./transactions', () => ({ logTransaction: vi.fn().mockResolvedValue({}) }))
vi.mock('./notifications', () => ({ createNotification: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./discord', () => ({ getMembersWithRoles: vi.fn().mockResolvedValue(['rev-1', 'rev-2', 'sub-1']), getUserRoles: vi.fn() }))

import {
  clearReviewNotifications,
  legacyMessageMatches,
  legacyTitleFragments,
  metadataCompletionId,
  planStaleReviews,
  reviewNotificationWhere,
} from './review-notifications'
import { approveMission, rejectMission, notifyReviewers } from './missions'
import { createNotification } from './notifications'
import { prisma } from './db'

const mockFn = (f: unknown) => f as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  mockFn(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma))
})

describe('notifyReviewers metadata', () => {
  beforeEach(() => {
    mockFn(prisma.missionCompletion.findUnique).mockResolvedValue({ status: 'PENDING' })
  })

  it('skips the pings when the completion already left PENDING (verifier won the race)', async () => {
    mockFn(prisma.missionCompletion.findUnique).mockResolvedValue({ status: 'APPROVED' })
    await notifyReviewers('sub-1', 'Join Pepperoni Mafia', 3, undefined, { completionId: 42, missionId: 7 })
    expect(createNotification).not.toHaveBeenCalled()
  })

  it('skips the pings when the completion is gone', async () => {
    mockFn(prisma.missionCompletion.findUnique).mockResolvedValue(null)
    await notifyReviewers('sub-1', 'Join Pepperoni Mafia', 3, undefined, { completionId: 42, missionId: 7 })
    expect(createNotification).not.toHaveBeenCalled()
  })

  it('carries completionId + missionId and links to the missions page', async () => {
    await notifyReviewers('sub-1', 'Join Pepperoni Mafia', 3, undefined, { completionId: 42, missionId: 7 })
    const calls = mockFn(createNotification).mock.calls.map(([a]) => a)
    expect(calls.map((c) => c.recipientId).sort()).toEqual(['rev-1', 'rev-2'])
    for (const c of calls) {
      expect(c.type).toBe('MISSION_SUBMITTED')
      expect(c.metadata).toEqual({ completionId: 42, missionId: 7 })
      expect(c.linkUrl).toBe('/missions')
      expect(c.actorId).toBe('sub-1')
    }
  })
})

describe('matching', () => {
  it('reads the completionId out of metadata only when it is an integer', () => {
    expect(metadataCompletionId({ completionId: 5, missionId: 1 })).toBe(5)
    expect(metadataCompletionId(null)).toBeNull()
    expect(metadataCompletionId({ completionId: '5' })).toBeNull()
    expect(metadataCompletionId([5])).toBeNull()
  })

  it('matches both message shapes, including long titles cut two ways', () => {
    const t = 'Join Pepperoni Mafia'
    expect(legacyMessageMatches('New submission for "Join Pepperoni Mafia" needs approval.', t)).toBe(true)
    expect(legacyMessageMatches('"Join Pepperoni Mafia" was auto-verified and awaits your release (Level 6+ needs', t)).toBe(true)
    expect(legacyMessageMatches('New submission for "Join Pepperoni Mafia Part 2" needs approval.', t)).toBe(false)
    const long = 'A'.repeat(60)
    expect(legacyTitleFragments(long)).toHaveLength(2)
    expect(legacyMessageMatches(`New submission for "${'A'.repeat(47)}..." needs approval.`, long)).toBe(true)
    expect(legacyMessageMatches(`"${'A'.repeat(50)}" was auto-verified and needs your approval (x).`, long)).toBe(true)
  })

  it('where clause covers metadata completionId and legacy null-metadata rows', () => {
    const w = reviewNotificationWhere({ id: 9, discordId: 'sub-1', missionTitle: 'Join Pepperoni Mafia' })
    expect(w.type).toBe('MISSION_SUBMITTED')
    expect(w.readAt).toBeNull()
    const [byMeta, legacy] = w.OR as Array<Record<string, unknown>>
    expect(byMeta).toEqual({ metadata: { path: ['completionId'], equals: 9 } })
    expect(legacy.actorId).toBe('sub-1')
    expect(legacy.OR).toEqual([{ message: { contains: '"Join Pepperoni Mafia"' } }])
  })
})

describe('planStaleReviews', () => {
  const completions = [
    { id: 1, discordId: 'a', status: 'APPROVED', mission: { title: 'Join Pepperoni Mafia' } },
    { id: 2, discordId: 'a', status: 'PENDING', mission: { title: 'Another Mission' } },
    { id: 3, discordId: 'b', status: 'REJECTED', mission: { title: 'Join Pepperoni Mafia' } },
  ]
  it('sorts rows into stale, still pending and unmatched', () => {
    const plan = planStaleReviews(
      [
        { id: 'n1', actorId: 'x', message: 'whatever', metadata: { completionId: 1 } }, // new, approved
        { id: 'n2', actorId: 'x', message: 'whatever', metadata: { completionId: 2 } }, // new, pending
        { id: 'n3', actorId: 'a', message: '"Join Pepperoni Mafia" was auto-verified and awaits', metadata: null }, // legacy, approved
        { id: 'n4', actorId: 'a', message: 'New submission for "Another Mission" needs approval.', metadata: null }, // legacy, pending
        { id: 'n5', actorId: 'b', message: 'New submission for "Join Pepperoni Mafia" needs approval.', metadata: null }, // legacy, rejected
        { id: 'n6', actorId: 'c', message: 'New submission for "Join Pepperoni Mafia" needs approval.', metadata: null }, // other submitter
        { id: 'n7', actorId: 'x', message: 'gone', metadata: { completionId: 99 } }, // deleted completion
      ],
      completions,
    )
    expect(plan.stale.sort()).toEqual(['n1', 'n3', 'n5'])
    expect(plan.pending.sort()).toEqual(['n2', 'n4'])
    expect(plan.unmatched.sort()).toEqual(['n6', 'n7'])
  })
})

describe('clearReviewNotifications', () => {
  it('marks every unread review ping of the completion read for all recipients', async () => {
    mockFn(prisma.missionCompletion.findUnique).mockResolvedValue({ id: 9, discordId: 'sub-1', mission: { title: 'Join Pepperoni Mafia' } })
    mockFn(prisma.notification.updateMany).mockResolvedValue({ count: 4 })
    const cutoff = new Date('2026-01-01T00:00:00Z')
    expect(await clearReviewNotifications(9, cutoff)).toBe(4)
    const arg = mockFn(prisma.notification.updateMany).mock.calls[0][0]
    expect(arg.where).toEqual(reviewNotificationWhere({ id: 9, discordId: 'sub-1', missionTitle: 'Join Pepperoni Mafia' }, cutoff))
    // a fresh submission's ping (created after the transition) is outside the clear
    expect(arg.where.createdAt).toEqual({ lte: cutoff })
    expect(arg.data.readAt).toBeInstanceOf(Date)
  })

  it('is fail-soft', async () => {
    mockFn(prisma.missionCompletion.findUnique).mockRejectedValue(new Error('db down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(clearReviewNotifications(9)).resolves.toBe(0)
    spy.mockRestore()
  })
})

describe('review actions clear the pings', () => {
  const pending = {
    id: 9,
    missionId: 7,
    discordId: 'sub-1',
    status: 'PENDING',
    holdReason: null,
    mission: { id: 7, title: 'Join Pepperoni Mafia', level: 1 },
  }
  beforeEach(() => {
    mockFn(prisma.missionCompletion.findUnique).mockResolvedValue(pending)
    mockFn(prisma.missionCompletion.findUniqueOrThrow).mockResolvedValue({ ...pending, status: 'APPROVED' })
    mockFn(prisma.missionCompletion.updateMany).mockResolvedValue({ count: 1 })
    mockFn(prisma.notification.updateMany).mockResolvedValue({ count: 2 })
    mockFn(prisma.missionReviewEvent.create).mockResolvedValue({})
    mockFn(prisma.mission.findMany).mockResolvedValue([])
    mockFn(prisma.missionCompletion.findMany).mockResolvedValue([])
    mockFn(prisma.transaction.findMany).mockResolvedValue([])
    mockFn(prisma.$queryRaw).mockResolvedValue([])
  })
  const cleared = () => mockFn(prisma.notification.updateMany).mock.calls.filter(([a]) => a.where?.type === 'MISSION_SUBMITTED')

  it('approve (and release) clears them', async () => {
    await approveMission('rev-1', 9).catch(() => {})
    expect(cleared()).toHaveLength(1)
  })

  it('reject clears them', async () => {
    mockFn(prisma.missionCompletion.findUniqueOrThrow).mockResolvedValue({ ...pending, status: 'REJECTED' })
    await rejectMission('rev-1', 9, 'no')
    expect(cleared()).toHaveLength(1)
  })

  it('a lost race (already reviewed) clears nothing and a clearing failure never breaks the review', async () => {
    mockFn(prisma.missionCompletion.updateMany).mockResolvedValue({ count: 0 })
    await expect(rejectMission('rev-1', 9)).rejects.toThrow()
    expect(cleared()).toHaveLength(0)

    mockFn(prisma.missionCompletion.updateMany).mockResolvedValue({ count: 1 })
    mockFn(prisma.notification.updateMany).mockRejectedValue(new Error('boom'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(rejectMission('rev-1', 9)).resolves.toBeTruthy()
    spy.mockRestore()
  })
})
