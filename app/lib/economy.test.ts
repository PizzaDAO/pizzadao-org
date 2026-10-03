import { describe, it, expect, vi, beforeEach } from 'vitest'
import { transfer, getOrCreateEconomy, creditInTx, debitInTx } from './economy'
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
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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

  it('should reject non-integer amounts', async () => {
    await expect(transfer('sender-1', 'recipient-1', 1.5)).rejects.toThrow('Amount must be positive')
    await expect(transfer('sender-1', 'recipient-1', NaN)).rejects.toThrow('Amount must be positive')
  })

  it('debits atomically and fails if a concurrent transfer drained the wallet', async () => {
    ;(prisma.economy.findUnique as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'sender-1', wallet: 500 }) // stale read passes the pre-check
      .mockResolvedValueOnce({ id: 'recipient-1', wallet: 100 })

    const updateMany = vi.fn().mockResolvedValue({ count: 0 }) // conditional debit matched no row
    const update = vi.fn().mockResolvedValue({})
    ;(prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({ economy: { update, updateMany } })
    })

    await expect(transfer('sender-1', 'recipient-1', 100)).rejects.toThrow('Insufficient funds')
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'sender-1', wallet: { gte: 100 } },
      data: { wallet: { decrement: 100 } },
    })
    expect(update).not.toHaveBeenCalled() // recipient never credited
  })
})

describe('creditInTx / debitInTx', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reject zero, negative, fractional and out-of-range amounts before touching the DB', async () => {
    const tx = { economy: { update: vi.fn(), updateMany: vi.fn() } }
    for (const bad of [0, -1, 1.5, NaN, Infinity, 2 ** 31]) {
      await expect(creditInTx(tx as never, 'u', bad, 'JOB_REWARD', 'x')).rejects.toThrow('whole number')
      await expect(debitInTx(tx as never, 'u', bad, 'SHOP_PURCHASE', 'x')).rejects.toThrow('whole number')
    }
    expect(tx.economy.update).not.toHaveBeenCalled()
    expect(tx.economy.updateMany).not.toHaveBeenCalled()
  })

  it('debit logs a negative ledger amount only after the conditional update succeeds', async () => {
    const tx = { economy: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } }
    await debitInTx(tx as never, 'u', 25, 'SHOP_PURCHASE', 'Bought', { itemId: 1 })
    expect(logTransaction).toHaveBeenCalledWith(tx, 'u', 'SHOP_PURCHASE', -25, 'Bought', { itemId: 1 })
  })
})

describe('getOrCreateEconomy', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the existing row without writing', async () => {
    ;(prisma.economy.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'u', wallet: 5 })
    await expect(getOrCreateEconomy('u')).resolves.toEqual({ id: 'u', wallet: 5 })
    expect(prisma.economy.upsert).not.toHaveBeenCalled()
  })

  it('survives losing a concurrent first-insert race', async () => {
    ;(prisma.economy.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(prisma.user.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({})
    ;(prisma.economy.upsert as ReturnType<typeof vi.fn>).mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }))
    ;(prisma.economy.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'u', wallet: 0 })
    await expect(getOrCreateEconomy('u')).resolves.toEqual({ id: 'u', wallet: 0 })
  })
})
