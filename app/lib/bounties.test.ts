import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createBounty, completeBounty, cancelBounty } from './bounties'
import { prisma } from './db'

vi.mock('./db')
vi.mock('./economy', () => ({
  getOrCreateEconomy: vi.fn(),
  updateBalance: vi.fn(),
}))
vi.mock('./notifications', () => ({
  notifyBountyClaimed: vi.fn().mockResolvedValue(undefined),
  notifyBountyCompleted: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./transactions', () => ({
  logTransaction: vi.fn().mockResolvedValue({
    id: 1,
    userId: '',
    type: '',
    amount: 0,
    balance: 0,
    description: '',
    metadata: null,
    createdAt: new Date(),
  }),
}))

import { getOrCreateEconomy, updateBalance } from './economy'
import { logTransaction } from './transactions'

describe('createBounty', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should escrow funds and log a BOUNTY_ESCROW transaction', async () => {
    ;(getOrCreateEconomy as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'creator-1', wallet: 500 })
    ;(updateBalance as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'creator-1', wallet: 400 })
    ;(prisma.bounty.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 10,
      description: 'Fix the bug',
      reward: 100,
      createdBy: 'creator-1',
      status: 'OPEN',
    })

    const bounty = await createBounty('creator-1', 'Fix the bug', 100)

    expect(updateBalance).toHaveBeenCalledWith('creator-1', -100)
    expect(logTransaction).toHaveBeenCalledWith(
      prisma,
      'creator-1',
      'BOUNTY_ESCROW',
      -100,
      'Bounty escrow: Fix the bug',
      { bountyId: 10 }
    )
    expect(bounty.id).toBe(10)
    expect(bounty.status).toBe('OPEN')
  })

  it('should throw ValidationError for zero reward', async () => {
    await expect(createBounty('creator-1', 'Do thing', 0)).rejects.toThrow('Reward must be positive')
  })

  it('should throw ValidationError for empty description', async () => {
    await expect(createBounty('creator-1', '   ', 100)).rejects.toThrow('Description is required')
  })

  it('should throw ValidationError for insufficient funds', async () => {
    ;(getOrCreateEconomy as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'creator-1', wallet: 50 })

    await expect(createBounty('creator-1', 'Expensive task', 100)).rejects.toThrow('Insufficient funds')
  })
})

describe('completeBounty', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should pay the claimer and log a BOUNTY_REWARD transaction', async () => {
    ;(prisma.bounty.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 10,
      description: 'Fix the bug',
      reward: 100,
      createdBy: 'creator-1',
      claimedBy: 'claimer-1',
      status: 'CLAIMED',
    })
    ;(updateBalance as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'claimer-1', wallet: 200 })
    ;(prisma.bounty.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 10,
      status: 'COMPLETED',
    })

    const result = await completeBounty('creator-1', 10)

    expect(updateBalance).toHaveBeenCalledWith('claimer-1', 100)
    expect(logTransaction).toHaveBeenCalledWith(
      prisma,
      'claimer-1',
      'BOUNTY_REWARD',
      100,
      'Bounty reward: Fix the bug',
      { bountyId: 10 }
    )
    expect(result.status).toBe('COMPLETED')
  })

  it('should throw NotFoundError when bounty does not exist', async () => {
    ;(prisma.bounty.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    await expect(completeBounty('creator-1', 999)).rejects.toThrow('Bounty not found')
  })

  it('should throw ForbiddenError when user is not the creator', async () => {
    ;(prisma.bounty.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 10,
      createdBy: 'creator-1',
      claimedBy: 'claimer-1',
      status: 'CLAIMED',
    })

    await expect(completeBounty('other-user', 10)).rejects.toThrow('Only the bounty creator')
  })
})

describe('cancelBounty', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should refund the creator and log a BOUNTY_REFUND transaction', async () => {
    ;(prisma.bounty.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 10,
      description: 'Fix the bug',
      reward: 100,
      createdBy: 'creator-1',
      claimedBy: null,
      status: 'OPEN',
    })
    ;(updateBalance as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'creator-1', wallet: 600 })
    ;(prisma.bounty.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 10,
      status: 'CANCELLED',
    })

    const result = await cancelBounty('creator-1', 10)

    expect(updateBalance).toHaveBeenCalledWith('creator-1', 100)
    expect(logTransaction).toHaveBeenCalledWith(
      prisma,
      'creator-1',
      'BOUNTY_REFUND',
      100,
      'Bounty refund: Fix the bug',
      { bountyId: 10 }
    )
    expect(result.status).toBe('CANCELLED')
  })

  it('should throw ConflictError when bounty is already completed', async () => {
    ;(prisma.bounty.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 10,
      createdBy: 'creator-1',
      status: 'COMPLETED',
    })

    await expect(cancelBounty('creator-1', 10)).rejects.toThrow('Cannot cancel a completed bounty')
  })

  it('should throw ConflictError when bounty is already cancelled', async () => {
    ;(prisma.bounty.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 10,
      createdBy: 'creator-1',
      status: 'CANCELLED',
    })

    await expect(cancelBounty('creator-1', 10)).rejects.toThrow('already cancelled')
  })
})
