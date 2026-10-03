import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createBounty, claimBounty, completeBounty, cancelBounty } from './bounties'
import { prisma } from './db'

vi.mock('./db')
// Real debitInTx / creditInTx (so the tests see the wallet + ledger writes);
// only the wallet-row bootstrap is mocked.
vi.mock('./economy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./economy')>()),
  getOrCreateEconomy: vi.fn(),
}))
vi.mock('./notifications', () => ({
  notifyBountyClaimed: vi.fn().mockResolvedValue(undefined),
  notifyBountyCompleted: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./transactions', () => ({
  logTransaction: vi.fn().mockResolvedValue({}),
}))

import { getOrCreateEconomy } from './economy'
import { logTransaction } from './transactions'

const mockFn = (f: unknown) => f as ReturnType<typeof vi.fn>

/** The tx client is the mocked prisma itself; $transaction just runs the callback. */
function runTxOnPrisma() {
  mockFn(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma))
}

const CLAIMED = {
  id: 10,
  description: 'Fix the bug',
  reward: 100,
  createdBy: 'creator-1',
  claimedBy: 'claimer-1',
  status: 'CLAIMED',
}

beforeEach(() => {
  vi.clearAllMocks()
  runTxOnPrisma()
  mockFn(getOrCreateEconomy).mockResolvedValue({ id: 'creator-1', wallet: 500 })
  mockFn(prisma.economy.update).mockResolvedValue({})
  mockFn(prisma.economy.updateMany).mockResolvedValue({ count: 1 })
})

describe('createBounty', () => {
  it('creates the bounty and escrows (conditional debit + BOUNTY_ESCROW) in one transaction', async () => {
    mockFn(prisma.bounty.create).mockResolvedValue({ id: 10, description: 'Fix the bug', reward: 100, createdBy: 'creator-1', status: 'OPEN' })

    const bounty = await createBounty('creator-1', 'Fix the bug', 100)

    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.economy.updateMany).toHaveBeenCalledWith({
      where: { id: 'creator-1', wallet: { gte: 100 } },
      data: { wallet: { decrement: 100 } },
    })
    expect(logTransaction).toHaveBeenCalledWith(prisma, 'creator-1', 'BOUNTY_ESCROW', -100, 'Bounty escrow: Fix the bug', { bountyId: 10 })
    expect(bounty.id).toBe(10)
    expect(bounty.status).toBe('OPEN')
  })

  it('fails (rolling back the bounty row) when a concurrent spend drained the wallet', async () => {
    mockFn(prisma.bounty.create).mockResolvedValue({ id: 10 })
    mockFn(prisma.economy.updateMany).mockResolvedValue({ count: 0 })

    await expect(createBounty('creator-1', 'Fix the bug', 100)).rejects.toThrow('Insufficient funds to escrow reward')
    expect(logTransaction).not.toHaveBeenCalled()
  })

  it('rejects zero, negative and fractional rewards', async () => {
    await expect(createBounty('creator-1', 'Do thing', 0)).rejects.toThrow('Reward must be a positive whole number')
    await expect(createBounty('creator-1', 'Do thing', -5)).rejects.toThrow('Reward must be a positive whole number')
    await expect(createBounty('creator-1', 'Do thing', 1.5)).rejects.toThrow('Reward must be a positive whole number')
  })

  it('should throw ValidationError for empty description', async () => {
    await expect(createBounty('creator-1', '   ', 100)).rejects.toThrow('Description is required')
  })

  it('should throw ValidationError for insufficient funds', async () => {
    mockFn(getOrCreateEconomy).mockResolvedValue({ id: 'creator-1', wallet: 50 })
    await expect(createBounty('creator-1', 'Expensive task', 100)).rejects.toThrow('Insufficient funds')
  })
})

describe('claimBounty', () => {
  it('claims with a conditional OPEN -> CLAIMED update', async () => {
    mockFn(prisma.bounty.findUnique).mockResolvedValue({ ...CLAIMED, claimedBy: null, status: 'OPEN' })
    mockFn(prisma.bounty.updateMany).mockResolvedValue({ count: 1 })

    const result = await claimBounty('claimer-1', 10)

    expect(prisma.bounty.updateMany).toHaveBeenCalledWith({
      where: { id: 10, status: 'OPEN' },
      data: { claimedBy: 'claimer-1', status: 'CLAIMED' },
    })
    expect(result.status).toBe('CLAIMED')
  })

  it('loses cleanly when someone else claimed it concurrently', async () => {
    mockFn(prisma.bounty.findUnique).mockResolvedValue({ ...CLAIMED, claimedBy: null, status: 'OPEN' })
    mockFn(prisma.bounty.updateMany).mockResolvedValue({ count: 0 })

    await expect(claimBounty('claimer-2', 10)).rejects.toThrow('Bounty is not available')
  })
})

describe('completeBounty', () => {
  it('flips CLAIMED -> COMPLETED and pays the claimer (+ BOUNTY_REWARD) in one transaction', async () => {
    mockFn(prisma.bounty.findUnique).mockResolvedValue(CLAIMED)
    mockFn(prisma.bounty.updateMany).mockResolvedValue({ count: 1 })

    const result = await completeBounty('creator-1', 10)

    expect(prisma.bounty.updateMany).toHaveBeenCalledWith({
      where: { id: 10, createdBy: 'creator-1', status: 'CLAIMED', claimedBy: 'claimer-1' },
      data: { status: 'COMPLETED' },
    })
    expect(prisma.economy.update).toHaveBeenCalledWith({
      where: { id: 'claimer-1' },
      data: { wallet: { increment: 100 } },
    })
    expect(logTransaction).toHaveBeenCalledWith(prisma, 'claimer-1', 'BOUNTY_REWARD', 100, 'Bounty reward: Fix the bug', { bountyId: 10 })
    expect(result.status).toBe('COMPLETED')
  })

  it('does not pay when a concurrent complete/cancel already released the escrow', async () => {
    mockFn(prisma.bounty.findUnique).mockResolvedValue(CLAIMED) // stale read
    mockFn(prisma.bounty.updateMany).mockResolvedValue({ count: 0 })

    await expect(completeBounty('creator-1', 10)).rejects.toThrow('no longer awaiting completion')
    expect(prisma.economy.update).not.toHaveBeenCalled()
    expect(logTransaction).not.toHaveBeenCalled()
  })

  it('should throw NotFoundError when bounty does not exist', async () => {
    mockFn(prisma.bounty.findUnique).mockResolvedValue(null)
    await expect(completeBounty('creator-1', 999)).rejects.toThrow('Bounty not found')
  })

  it('should throw ForbiddenError when user is not the creator', async () => {
    mockFn(prisma.bounty.findUnique).mockResolvedValue(CLAIMED)
    await expect(completeBounty('other-user', 10)).rejects.toThrow('Only the bounty creator')
  })
})

describe('cancelBounty', () => {
  it('flips OPEN/CLAIMED -> CANCELLED and refunds (+ BOUNTY_REFUND) in one transaction', async () => {
    mockFn(prisma.bounty.findUnique).mockResolvedValue({ ...CLAIMED, claimedBy: null, status: 'OPEN' })
    mockFn(prisma.bounty.updateMany).mockResolvedValue({ count: 1 })

    const result = await cancelBounty('creator-1', 10)

    expect(prisma.bounty.updateMany).toHaveBeenCalledWith({
      where: { id: 10, createdBy: 'creator-1', status: { in: ['OPEN', 'CLAIMED'] } },
      data: { status: 'CANCELLED' },
    })
    expect(prisma.economy.update).toHaveBeenCalledWith({
      where: { id: 'creator-1' },
      data: { wallet: { increment: 100 } },
    })
    expect(logTransaction).toHaveBeenCalledWith(prisma, 'creator-1', 'BOUNTY_REFUND', 100, 'Bounty refund: Fix the bug', { bountyId: 10 })
    expect(result.status).toBe('CANCELLED')
  })

  it('does not refund twice when a concurrent cancel/complete won', async () => {
    mockFn(prisma.bounty.findUnique).mockResolvedValue({ ...CLAIMED, status: 'OPEN' })
    mockFn(prisma.bounty.updateMany).mockResolvedValue({ count: 0 })

    await expect(cancelBounty('creator-1', 10)).rejects.toThrow('can no longer be cancelled')
    expect(prisma.economy.update).not.toHaveBeenCalled()
  })

  it('should throw ConflictError when bounty is already completed', async () => {
    mockFn(prisma.bounty.findUnique).mockResolvedValue({ id: 10, createdBy: 'creator-1', status: 'COMPLETED' })
    await expect(cancelBounty('creator-1', 10)).rejects.toThrow('Cannot cancel a completed bounty')
  })

  it('should throw ConflictError when bounty is already cancelled', async () => {
    mockFn(prisma.bounty.findUnique).mockResolvedValue({ id: 10, createdBy: 'creator-1', status: 'CANCELLED' })
    await expect(cancelBounty('creator-1', 10)).rejects.toThrow('already cancelled')
  })
})
