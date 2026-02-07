import { describe, it, expect, vi, beforeEach } from 'vitest'
import { transfer } from './economy'
import { prisma } from './db'

vi.mock('./db')
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

import { logTransaction } from './transactions'

describe('transfer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should log both TRANSFER_SENT and TRANSFER_RECEIVED within a transaction', async () => {
    // Mock economy lookups for sender and recipient
    ;(prisma.economy.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'sender-1', wallet: 500 }) // getOrCreateEconomy for sender
      .mockResolvedValueOnce({ id: 'recipient-1', wallet: 100 }) // getOrCreateEconomy for recipient

    // Mock the $transaction to execute the callback immediately
    ;(prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      const txClient = {
        economy: {
          update: vi.fn().mockResolvedValue({}),
        },
      }
      await fn(txClient)
      return txClient
    })

    const result = await transfer('sender-1', 'recipient-1', 100)

    expect(result).toEqual({ success: true, amount: 100 })

    // Verify logTransaction was called inside the $transaction callback
    expect(logTransaction).toHaveBeenCalledTimes(2)
    expect(logTransaction).toHaveBeenCalledWith(
      expect.anything(), // tx client
      'sender-1',
      'TRANSFER_SENT',
      -100,
      'Transfer to recipient-1',
      { toUserId: 'recipient-1' }
    )
    expect(logTransaction).toHaveBeenCalledWith(
      expect.anything(), // tx client
      'recipient-1',
      'TRANSFER_RECEIVED',
      100,
      'Transfer from sender-1',
      { fromUserId: 'sender-1' }
    )
  })

  it('should throw ValidationError for non-positive amount', async () => {
    await expect(transfer('sender-1', 'recipient-1', 0)).rejects.toThrow('Amount must be positive')
    await expect(transfer('sender-1', 'recipient-1', -10)).rejects.toThrow('Amount must be positive')
  })

  it('should throw ValidationError when transferring to self', async () => {
    await expect(transfer('sender-1', 'sender-1', 100)).rejects.toThrow('Cannot transfer to yourself')
  })

  it('should throw ValidationError for insufficient funds', async () => {
    ;(prisma.economy.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'sender-1', wallet: 50 }) // sender
      .mockResolvedValueOnce({ id: 'recipient-1', wallet: 100 }) // recipient

    await expect(transfer('sender-1', 'recipient-1', 100)).rejects.toThrow('Insufficient funds')
  })
})
