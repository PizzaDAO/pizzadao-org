import { describe, it, expect, vi, beforeEach } from 'vitest'
import { logTransaction, getTransactionHistory } from './transactions'
import { prisma } from './db'
import { Prisma } from '@prisma/client'

// Use the auto-mock from __mocks__/db.ts
vi.mock('./db')

describe('logTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should create a transaction with the current wallet balance', async () => {
    const mockClient = {
      economy: { findUnique: vi.fn().mockResolvedValue({ wallet: 500 }) },
      transaction: {
        create: vi.fn().mockResolvedValue({
          id: 1,
          userId: 'user-1',
          type: 'TRANSFER_SENT',
          amount: -100,
          balance: 500,
          description: 'Test transfer',
          metadata: null,
          createdAt: new Date(),
        }),
      },
    }

    const result = await logTransaction(
      mockClient as unknown as Prisma.TransactionClient,
      'user-1',
      'TRANSFER_SENT',
      -100,
      'Test transfer'
    )

    expect(mockClient.economy.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
    })
    expect(mockClient.transaction.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        type: 'TRANSFER_SENT',
        amount: -100,
        balance: 500,
        description: 'Test transfer',
        metadata: Prisma.JsonNull,
      },
    })
    expect(result.id).toBe(1)
  })

  it('should store metadata when provided', async () => {
    const metadata = { bountyId: 42 }
    const mockClient = {
      economy: { findUnique: vi.fn().mockResolvedValue({ wallet: 200 }) },
      transaction: {
        create: vi.fn().mockResolvedValue({
          id: 2,
          userId: 'user-2',
          type: 'BOUNTY_ESCROW',
          amount: -50,
          balance: 200,
          description: 'Bounty escrow',
          metadata,
          createdAt: new Date(),
        }),
      },
    }

    await logTransaction(
      mockClient as unknown as Prisma.TransactionClient,
      'user-2',
      'BOUNTY_ESCROW',
      -50,
      'Bounty escrow',
      metadata
    )

    expect(mockClient.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ metadata: { bountyId: 42 } }),
    })
  })

  it('should default balance to 0 when economy record does not exist', async () => {
    const mockClient = {
      economy: { findUnique: vi.fn().mockResolvedValue(null) },
      transaction: {
        create: vi.fn().mockResolvedValue({
          id: 3,
          userId: 'new-user',
          type: 'TRANSFER_RECEIVED',
          amount: 100,
          balance: 0,
          description: 'First deposit',
          metadata: null,
          createdAt: new Date(),
        }),
      },
    }

    await logTransaction(
      mockClient as unknown as Prisma.TransactionClient,
      'new-user',
      'TRANSFER_RECEIVED',
      100,
      'First deposit'
    )

    expect(mockClient.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ balance: 0 }),
    })
  })
})

describe('getTransactionHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return paginated transactions in descending order', async () => {
    const mockTransactions = [
      { id: 3, userId: 'user-1', type: 'SHOP_PURCHASE', amount: -20, balance: 480, description: 'Bought hat', createdAt: new Date('2025-01-03') },
      { id: 2, userId: 'user-1', type: 'JOB_REWARD', amount: 50, balance: 500, description: 'Job reward', createdAt: new Date('2025-01-02') },
    ]

    ;(prisma.transaction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(mockTransactions)
    ;(prisma.transaction.count as ReturnType<typeof vi.fn>).mockResolvedValue(5)

    const result = await getTransactionHistory('user-1', 2, 0)

    expect(result.transactions).toHaveLength(2)
    expect(result.total).toBe(5)
    expect(prisma.transaction.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { createdAt: 'desc' },
      take: 2,
      skip: 0,
    })
  })

  it('should use default limit and offset', async () => {
    ;(prisma.transaction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(prisma.transaction.count as ReturnType<typeof vi.fn>).mockResolvedValue(0)

    await getTransactionHistory('user-1')

    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20, skip: 0 })
    )
  })

  it('should support offset for pagination', async () => {
    ;(prisma.transaction.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(prisma.transaction.count as ReturnType<typeof vi.fn>).mockResolvedValue(50)

    const result = await getTransactionHistory('user-1', 10, 20)

    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10, skip: 20 })
    )
    expect(result.total).toBe(50)
  })
})
