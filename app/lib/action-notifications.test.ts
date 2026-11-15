// @vitest-environment node
// Clearing the "needs action" pings (bounty submitted, vouch request, disavow vote needed) once
// they are handled: the where clauses, fail-soft behaviour and the stale-backlog planners.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'

vi.mock('./db')

import {
  clearBountySubmittedNotifications,
  clearDisavowVoteNotificationFor,
  clearDisavowVoteNotifications,
  clearVouchRequestNotification,
  disavowalIdOf,
  planStaleBounties,
  planStaleDisavowVotes,
  planStaleVouchRequests,
} from './action-notifications'
import { prisma } from './db'

const mockFn = (f: unknown) => f as ReturnType<typeof vi.fn>
const lastWhere = () => mockFn(prisma.notification.updateMany).mock.calls.at(-1)![0].where

beforeEach(() => {
  vi.clearAllMocks()
  mockFn(prisma.notification.updateMany).mockResolvedValue({ count: 2 })
})

describe('BOUNTY_SUBMITTED', () => {
  it('marks every unread notification of the bounty read, for all recipients', async () => {
    expect(await clearBountySubmittedNotifications(10)).toBe(2)
    expect(lastWhere()).toEqual({ type: 'BOUNTY_SUBMITTED', metadata: { path: ['bountyId'], equals: 10 }, readAt: null })
    expect(mockFn(prisma.notification.updateMany).mock.calls[0][0].data.readAt).toBeInstanceOf(Date)
  })

  it('is fail-soft', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFn(prisma.notification.updateMany).mockRejectedValue(new Error('db down'))
    expect(await clearBountySubmittedNotifications(10)).toBe(0)
    expect(err).toHaveBeenCalled()
  })

  it('planStaleBounties: only bounties that left SUBMITTED are stale', () => {
    const plan = planStaleBounties(
      [
        { id: 'n1', metadata: { bountyId: 1 } }, // completed
        { id: 'n2', metadata: { bountyId: 2 } }, // still submitted
        { id: 'n3', metadata: { bountyId: 3 } }, // gone
        { id: 'n4', metadata: null }, // no id
        { id: 'n5', metadata: { bountyId: 4 } }, // sent back
      ],
      [{ id: 1, status: 'COMPLETED' }, { id: 2, status: 'SUBMITTED' }, { id: 4, status: 'CLAIMED' }],
    )
    expect(plan).toEqual({ stale: ['n1', 'n5'], kept: ['n2'], unmatched: ['n3', 'n4'] })
  })
})

describe('VOUCH_REQUEST', () => {
  it('marks only the vouching recipient\'s request from that requester read', async () => {
    await clearVouchRequestNotification('d-recipient', 'm-requester')
    expect(lastWhere()).toEqual({
      type: 'VOUCH_REQUEST',
      recipientId: 'd-recipient',
      metadata: { path: ['requesterMemberId'], equals: 'm-requester' },
      readAt: null,
    })
  })

  it('is fail-soft', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFn(prisma.notification.updateMany).mockRejectedValue(new Error('db down'))
    expect(await clearVouchRequestNotification('a', 'b')).toBe(0)
  })

  it('planStaleVouchRequests: stale once the recipient vouched for the requester', () => {
    const plan = planStaleVouchRequests(
      [
        { id: 'n1', recipientId: 'dA', metadata: { requesterMemberId: 'mR' } }, // A vouched for R
        { id: 'n2', recipientId: 'dB', metadata: { requesterMemberId: 'mR' } }, // B has not
        { id: 'n3', recipientId: 'dZ', metadata: { requesterMemberId: 'mR' } }, // unresolvable recipient
        { id: 'n4', recipientId: 'dA', metadata: null },
      ],
      new Map([['dA', 'mA'], ['dB', 'mB']]),
      new Set(['mA>mR']),
    )
    expect(plan).toEqual({ stale: ['n1'], kept: ['n2'], unmatched: ['n3', 'n4'] })
  })
})

describe('DISAVOW_VOTE_NEEDED', () => {
  it('closing clears every recipient\'s, matching metadata or the legacy link of a metadata-less row', async () => {
    await clearDisavowVoteNotifications('dis-1')
    expect(lastWhere()).toEqual({
      type: 'DISAVOW_VOTE_NEEDED',
      OR: [
        { metadata: { path: ['disavowalId'], equals: 'dis-1' } },
        { metadata: { equals: Prisma.DbNull }, linkUrl: '/disavow/dis-1' },
      ],
      readAt: null,
    })
  })

  it('a vote clears only the voter\'s own', async () => {
    await clearDisavowVoteNotificationFor('dis-1', 'dpr1')
    expect(lastWhere()).toMatchObject({ type: 'DISAVOW_VOTE_NEEDED', recipientId: 'dpr1', readAt: null })
  })

  it('is fail-soft', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFn(prisma.notification.updateMany).mockRejectedValue(new Error('db down'))
    expect(await clearDisavowVoteNotifications('x')).toBe(0)
  })

  it('disavowalIdOf reads metadata, then the exact legacy link, else null', () => {
    expect(disavowalIdOf({ metadata: { disavowalId: 'a' }, linkUrl: '/disavow/b' })).toBe('a')
    expect(disavowalIdOf({ metadata: null, linkUrl: '/disavow/b' })).toBe('b')
    expect(disavowalIdOf({ metadata: null, linkUrl: '/disavow?tab=mine' })).toBeNull()
    expect(disavowalIdOf({ metadata: null, linkUrl: null })).toBeNull()
  })

  it('planStaleDisavowVotes: closed rounds and own votes are stale, open and unknown are kept', () => {
    const plan = planStaleDisavowVotes(
      [
        { id: 'n1', recipientId: 'dpr1', metadata: { disavowalId: 'closed' }, linkUrl: '/disavow/closed' },
        { id: 'n2', recipientId: 'dpr1', metadata: null, linkUrl: '/disavow/closed' }, // legacy
        { id: 'n3', recipientId: 'dpr1', metadata: null, linkUrl: '/disavow/open' }, // voted
        { id: 'n4', recipientId: 'dpr2', metadata: null, linkUrl: '/disavow/open' }, // not voted
        { id: 'n5', recipientId: 'dpr2', metadata: null, linkUrl: '/disavow/missing' },
        { id: 'n6', recipientId: 'dpr2', metadata: null, linkUrl: '/somewhere' },
      ],
      [{ id: 'closed', openRoundVoters: null }, { id: 'open', openRoundVoters: ['dpr1'] }],
    )
    expect(plan).toEqual({ stale: ['n1', 'n2', 'n3'], kept: ['n4'], unmatched: ['n5', 'n6'] })
  })
})
