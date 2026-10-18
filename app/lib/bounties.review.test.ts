// jalapeno-82565 v2 — submit / reject / approve / cancel with crew-lead permissions.
// Real crew-leads permission logic; only its inputs (sheet roster, member lookup,
// admin check) are mocked.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { submitBounty, rejectBounty, completeBounty, cancelBounty, giveUpBounty } from './bounties'
import { prisma } from './db'

vi.mock('./db')
vi.mock('./economy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./economy')>()),
  getOrCreateEconomy: vi.fn(),
}))
vi.mock('./notifications', () => ({
  notifyBountyClaimed: vi.fn().mockResolvedValue(undefined),
  notifyBountyCompleted: vi.fn().mockResolvedValue(undefined),
  notifyBountyComment: vi.fn().mockResolvedValue(undefined),
  notifyBountySubmitted: vi.fn().mockResolvedValue(undefined),
  notifyBountyRejected: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./transactions', () => ({ logTransaction: vi.fn().mockResolvedValue({}) }))
vi.mock('./crew-mappings', () => ({ getCrewMappings: vi.fn() }))
vi.mock('./crew-sheet', () => ({ CREW_SHEET_REVALIDATE_SECONDS: 60, fetchCrewRoster: vi.fn() }))
vi.mock('./member-utils', () => ({ findMemberIdByDiscordId: vi.fn() }))
vi.mock('./auth-guards', () => ({ isAdminDiscordId: vi.fn() }))

import { getOrCreateEconomy } from './economy'
import { logTransaction } from './transactions'
import { getCrewMappings } from './crew-mappings'
import { fetchCrewRoster } from './crew-sheet'
import { findMemberIdByDiscordId } from './member-utils'
import { isAdminDiscordId } from './auth-guards'
import { notifyBountySubmitted, notifyBountyRejected, notifyBountyCompleted } from './notifications'

const mockFn = (f: unknown) => f as ReturnType<typeof vi.fn>

const POSTER = 'poster-1'
const CLAIMER = 'claimer-1'
const LEAD = 'lead-1' // Discord id of a lead of "ops"
const OTHER_LEAD = 'lead-2' // Discord id of a lead of "design"
const STRANGER = 'stranger-1'

const BASE = {
  id: 10,
  description: 'Fix the bug',
  reward: 100,
  createdBy: POSTER,
  claimedBy: CLAIMER,
  crewId: 'ops',
  status: 'SUBMITTED',
}

const MEMBER_OF: Record<string, string> = { [LEAD]: 'm-lead', [OTHER_LEAD]: 'm-lead2', [CLAIMER]: 'm-claimer' }
const ROSTERS: Record<string, { id: string; status: string }[]> = {
  ops: [
    { id: 'm-lead', status: 'Lead' },
    { id: 'm-claimer', status: 'Active' },
  ],
  design: [{ id: 'm-lead2', status: 'Capo' }],
}

let admins = new Set<string>()

beforeEach(() => {
  vi.clearAllMocks()
  admins = new Set()
  mockFn(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma))
  mockFn(getOrCreateEconomy).mockResolvedValue({ id: POSTER, wallet: 500 })
  mockFn(prisma.economy.update).mockResolvedValue({})
  mockFn(prisma.economy.updateMany).mockResolvedValue({ count: 1 })
  mockFn(getCrewMappings).mockResolvedValue({
    cached: true,
    crews: [
      { id: 'ops', label: 'Ops', sheet: 'https://docs.google.com/spreadsheets/d/ops/edit' },
      { id: 'design', label: 'Design', sheet: 'https://docs.google.com/spreadsheets/d/design/edit' },
    ],
  })
  mockFn(fetchCrewRoster).mockImplementation(async (url: string) => ROSTERS[url.includes('/ops/') ? 'ops' : 'design'])
  mockFn(findMemberIdByDiscordId).mockImplementation(async (d: string) => MEMBER_OF[d] ?? null)
  mockFn(isAdminDiscordId).mockImplementation(async (d: string) => admins.has(d))
})

describe('submitBounty', () => {
  it('moves CLAIMED -> SUBMITTED with note and https link, clears reviewNote', async () => {
    mockFn(prisma.bounty.findUnique).mockResolvedValue({ ...BASE, status: 'CLAIMED' })
    mockFn(prisma.bounty.updateMany).mockResolvedValue({ count: 1 })

    await submitBounty(CLAIMER, 10, '  did it  ', 'https://example.com/pr/1')

    expect(prisma.bounty.updateMany).toHaveBeenCalledWith({
      where: { id: 10, status: 'CLAIMED', claimedBy: CLAIMER },
      data: expect.objectContaining({
        status: 'SUBMITTED',
        submissionNote: 'did it',
        submissionLink: 'https://example.com/pr/1',
        reviewNote: null,
        submittedAt: expect.any(Date),
      }),
    })
    expect(notifyBountySubmitted).toHaveBeenCalledWith(POSTER, CLAIMER, 10, 'Fix the bug', 'ops')
    expect(prisma.economy.update).not.toHaveBeenCalled()
  })

  it('only the claimer can submit', async () => {
    mockFn(prisma.bounty.findUnique).mockResolvedValue({ ...BASE, status: 'CLAIMED' })
    await expect(submitBounty(POSTER, 10, 'x')).rejects.toThrow('Only the claimer')
    await expect(submitBounty(LEAD, 10, 'x')).rejects.toThrow('Only the claimer')
    expect(prisma.bounty.updateMany).not.toHaveBeenCalled()
  })

  it('only from CLAIMED', async () => {
    for (const status of ['OPEN', 'SUBMITTED', 'COMPLETED', 'CANCELLED']) {
      mockFn(prisma.bounty.findUnique).mockResolvedValue({ ...BASE, status })
      await expect(submitBounty(CLAIMER, 10, 'x')).rejects.toThrow('not in claimed status')
    }
  })

  it('requires a note, caps it at 2000 chars, and only accepts https links', async () => {
    mockFn(prisma.bounty.findUnique).mockResolvedValue({ ...BASE, status: 'CLAIMED' })
    await expect(submitBounty(CLAIMER, 10, '   ')).rejects.toThrow('note')
    await expect(submitBounty(CLAIMER, 10, 'x'.repeat(2001))).rejects.toThrow('2000')
    await expect(submitBounty(CLAIMER, 10, 'x', 'http://example.com')).rejects.toThrow('https')
    await expect(submitBounty(CLAIMER, 10, 'x', 'javascript:alert(1)')).rejects.toThrow('https')
    await expect(submitBounty(CLAIMER, 10, 'x', 'not a url')).rejects.toThrow('https')
    expect(prisma.bounty.updateMany).not.toHaveBeenCalled()
  })

  it('a lost race (updateMany count 0) is a ConflictError', async () => {
    mockFn(prisma.bounty.findUnique).mockResolvedValue({ ...BASE, status: 'CLAIMED' })
    mockFn(prisma.bounty.updateMany).mockResolvedValue({ count: 0 })
    await expect(submitBounty(CLAIMER, 10, 'x')).rejects.toMatchObject({ statusCode: 409 })
    expect(notifyBountySubmitted).not.toHaveBeenCalled()
  })
})

describe('rejectBounty', () => {
  it.each([
    ['the poster', POSTER],
    ['a lead of the crew', LEAD],
  ])('%s can send a submission back with a note, and no money moves', async (_n, who) => {
    mockFn(prisma.bounty.findUnique).mockResolvedValue(BASE)
    mockFn(prisma.bounty.updateMany).mockResolvedValue({ count: 1 })

    const res = await rejectBounty(who, 10, ' needs tests ')

    expect(prisma.bounty.updateMany).toHaveBeenCalledWith({
      where: { id: 10, status: 'SUBMITTED', claimedBy: CLAIMER },
      data: { status: 'CLAIMED', reviewNote: 'needs tests', reviewedBy: who },
    })
    expect(res.status).toBe('CLAIMED')
    expect(notifyBountyRejected).toHaveBeenCalledWith(CLAIMER, who, 10, 'Fix the bug', 'needs tests', 'ops')
    expect(prisma.economy.update).not.toHaveBeenCalled()
    expect(prisma.economy.updateMany).not.toHaveBeenCalled()
    expect(logTransaction).not.toHaveBeenCalled()
  })

  it('an admin can reject', async () => {
    admins.add('admin-1')
    mockFn(prisma.bounty.findUnique).mockResolvedValue(BASE)
    mockFn(prisma.bounty.updateMany).mockResolvedValue({ count: 1 })
    await expect(rejectBounty('admin-1', 10, 'no')).resolves.toMatchObject({ status: 'CLAIMED' })
  })

  it('a stranger, the claimer and a lead of another crew are forbidden', async () => {
    mockFn(prisma.bounty.findUnique).mockResolvedValue(BASE)
    for (const who of [STRANGER, CLAIMER, OTHER_LEAD]) {
      await expect(rejectBounty(who, 10, 'no')).rejects.toMatchObject({ statusCode: 403 })
    }
    expect(prisma.bounty.updateMany).not.toHaveBeenCalled()
  })

  it('needs a note and a SUBMITTED bounty', async () => {
    mockFn(prisma.bounty.findUnique).mockResolvedValue(BASE)
    await expect(rejectBounty(POSTER, 10, '  ')).rejects.toThrow('note')
    mockFn(prisma.bounty.findUnique).mockResolvedValue({ ...BASE, status: 'CLAIMED' })
    await expect(rejectBounty(POSTER, 10, 'no')).rejects.toMatchObject({ statusCode: 409 })
  })

  it('a lost race is a ConflictError', async () => {
    mockFn(prisma.bounty.findUnique).mockResolvedValue(BASE)
    mockFn(prisma.bounty.updateMany).mockResolvedValue({ count: 0 })
    await expect(rejectBounty(POSTER, 10, 'no')).rejects.toMatchObject({ statusCode: 409 })
    expect(notifyBountyRejected).not.toHaveBeenCalled()
  })
})

describe('completeBounty (approve)', () => {
  it.each(['CLAIMED', 'SUBMITTED'])('the poster can approve from %s', async (status) => {
    mockFn(prisma.bounty.findUnique).mockResolvedValue({ ...BASE, status })
    mockFn(prisma.bounty.updateMany).mockResolvedValue({ count: 1 })

    await completeBounty(POSTER, 10)

    expect(prisma.bounty.updateMany).toHaveBeenCalledWith({
      where: { id: 10, status: { in: ['CLAIMED', 'SUBMITTED'] }, claimedBy: CLAIMER },
      data: { status: 'COMPLETED', reviewedBy: POSTER, completedAt: expect.any(Date) },
    })
    expect(logTransaction).toHaveBeenCalledWith(prisma, CLAIMER, 'BOUNTY_REWARD', 100, 'Bounty reward: Fix the bug', {
      bountyId: 10,
      approvedBy: POSTER,
    })
  })

  it("a lead of the bounty's crew can approve, and the poster is told", async () => {
    mockFn(prisma.bounty.findUnique).mockResolvedValue(BASE)
    mockFn(prisma.bounty.updateMany).mockResolvedValue({ count: 1 })

    await completeBounty(LEAD, 10)

    expect(logTransaction).toHaveBeenCalledWith(prisma, CLAIMER, 'BOUNTY_REWARD', 100, expect.any(String), {
      bountyId: 10,
      approvedBy: LEAD,
    })
    expect(notifyBountyCompleted).toHaveBeenCalledWith(CLAIMER, LEAD, 10, 'Fix the bug', 100, 'ops', POSTER)
  })

  it('a lead of a DIFFERENT crew, and a stranger, cannot approve', async () => {
    mockFn(prisma.bounty.findUnique).mockResolvedValue(BASE)
    for (const who of [OTHER_LEAD, STRANGER]) {
      await expect(completeBounty(who, 10)).rejects.toMatchObject({ statusCode: 403 })
    }
    expect(prisma.bounty.updateMany).not.toHaveBeenCalled()
    expect(logTransaction).not.toHaveBeenCalled()
  })

  it('the claimer can never approve their own work, even as a lead or an admin', async () => {
    ROSTERS.ops.push({ id: 'm-claimer-lead', status: 'Lead' })
    MEMBER_OF[CLAIMER] = 'm-claimer-lead'
    admins.add(CLAIMER)
    try {
      mockFn(prisma.bounty.findUnique).mockResolvedValue(BASE)
      await expect(completeBounty(CLAIMER, 10)).rejects.toMatchObject({ statusCode: 403 })
      expect(prisma.bounty.updateMany).not.toHaveBeenCalled()
      expect(logTransaction).not.toHaveBeenCalled()
      expect(prisma.economy.update).not.toHaveBeenCalled()
    } finally {
      ROSTERS.ops.pop()
      MEMBER_OF[CLAIMER] = 'm-claimer'
    }
  })

  it('an admin can approve', async () => {
    admins.add('admin-1')
    mockFn(prisma.bounty.findUnique).mockResolvedValue(BASE)
    mockFn(prisma.bounty.updateMany).mockResolvedValue({ count: 1 })
    await expect(completeBounty('admin-1', 10)).resolves.toMatchObject({ status: 'COMPLETED' })
  })

  it('pays exactly once: a lost race pays nothing', async () => {
    mockFn(prisma.bounty.findUnique).mockResolvedValue(BASE)
    mockFn(prisma.bounty.updateMany).mockResolvedValue({ count: 0 })
    await expect(completeBounty(POSTER, 10)).rejects.toMatchObject({ statusCode: 409 })
    expect(prisma.economy.update).not.toHaveBeenCalled()
    expect(logTransaction).not.toHaveBeenCalled()
  })

  it('fails closed when the sheet roster is unreachable', async () => {
    mockFn(fetchCrewRoster).mockRejectedValue(new Error('sheet down'))
    mockFn(prisma.bounty.findUnique).mockResolvedValue(BASE)
    await expect(completeBounty(LEAD, 10)).rejects.toMatchObject({ statusCode: 403 })
    expect(logTransaction).not.toHaveBeenCalled()
  })
})

describe('cancelBounty', () => {
  it('a lead cancels and the refund goes to the POSTER, not the lead', async () => {
    mockFn(prisma.bounty.findUnique).mockResolvedValue(BASE)
    mockFn(prisma.bounty.updateMany).mockResolvedValue({ count: 1 })

    await cancelBounty(LEAD, 10)

    expect(prisma.bounty.updateMany).toHaveBeenCalledWith({
      where: { id: 10, status: { in: ['OPEN', 'CLAIMED', 'SUBMITTED'] } },
      data: { status: 'CANCELLED', reviewedBy: LEAD },
    })
    expect(prisma.economy.update).toHaveBeenCalledWith({ where: { id: POSTER }, data: { wallet: { increment: 100 } } })
    expect(logTransaction).toHaveBeenCalledTimes(1)
    expect(logTransaction).toHaveBeenCalledWith(prisma, POSTER, 'BOUNTY_REFUND', 100, expect.any(String), {
      bountyId: 10,
      cancelledBy: LEAD,
    })
  })

  it('an admin cancel also refunds the poster', async () => {
    admins.add('admin-1')
    mockFn(prisma.bounty.findUnique).mockResolvedValue({ ...BASE, crewId: null, status: 'OPEN', claimedBy: null })
    mockFn(prisma.bounty.updateMany).mockResolvedValue({ count: 1 })
    await cancelBounty('admin-1', 10)
    expect(prisma.economy.update).toHaveBeenCalledWith({ where: { id: POSTER }, data: { wallet: { increment: 100 } } })
  })

  it('a lead of another crew, a stranger and the claimer cannot cancel', async () => {
    mockFn(prisma.bounty.findUnique).mockResolvedValue(BASE)
    for (const who of [OTHER_LEAD, STRANGER, CLAIMER]) {
      await expect(cancelBounty(who, 10)).rejects.toMatchObject({ statusCode: 403 })
    }
    expect(logTransaction).not.toHaveBeenCalled()
  })

  it('a general (untagged) bounty can only be cancelled by its poster or an admin', async () => {
    mockFn(prisma.bounty.findUnique).mockResolvedValue({ ...BASE, crewId: null })
    await expect(cancelBounty(LEAD, 10)).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('giveUpBounty', () => {
  it('from SUBMITTED clears the submission fields and reopens', async () => {
    mockFn(prisma.bounty.findUnique).mockResolvedValue(BASE)
    mockFn(prisma.bounty.updateMany).mockResolvedValue({ count: 1 })

    const res = await giveUpBounty(CLAIMER, 10)

    expect(prisma.bounty.updateMany).toHaveBeenCalledWith({
      where: { id: 10, status: { in: ['CLAIMED', 'SUBMITTED'] }, claimedBy: CLAIMER },
      data: {
        claimedBy: null,
        status: 'OPEN',
        submissionNote: null,
        submissionLink: null,
        submittedAt: null,
        reviewNote: null,
      },
    })
    expect(res.status).toBe('OPEN')
  })
})
