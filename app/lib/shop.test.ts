import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buyItem } from './shop'
import { prisma } from './db'

vi.mock('./db')
vi.mock('./economy', () => ({
  getOrCreateEconomy: vi.fn(),
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

import { getOrCreateEconomy } from './economy'
import { logTransaction } from './transactions'

describe('buyItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should log a SHOP_PURCHASE transaction inside $transaction', async () => {
    ;(prisma.shopItem.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 5,
      name: 'Cool Hat',
      price: 30,
      quantity: -1, // unlimited
      isAvailable: true,
    })

    ;(getOrCreateEconomy as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'buyer-1', wallet: 200 })

    // Mock the $transaction to execute the callback
    ;(prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      const txClient = {
        economy: { update: vi.fn().mockResolvedValue({}) },
        shopItem: { update: vi.fn().mockResolvedValue({}) },
        inventory: { upsert: vi.fn().mockResolvedValue({}) },
      }
      await fn(txClient)
    })

    const result = await buyItem('buyer-1', 5, 2)

    expect(result).toEqual({
      success: true,
      item: 'Cool Hat',
      quantity: 2,
      totalCost: 60,
    })

    expect(logTransaction).toHaveBeenCalledWith(
      expect.anything(), // tx client
      'buyer-1',
      'SHOP_PURCHASE',
      -60,
      'Purchased 2x Cool Hat',
      { itemId: 5, itemName: 'Cool Hat', quantity: 2 }
    )
  })

  it('should throw for non-existent item', async () => {
    ;(prisma.shopItem.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    await expect(buyItem('buyer-1', 999)).rejects.toThrow('Item not found')
  })

  it('should throw for unavailable item', async () => {
    ;(prisma.shopItem.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 5,
      name: 'Cool Hat',
      price: 30,
      quantity: -1,
      isAvailable: false,
    })

    await expect(buyItem('buyer-1', 5)).rejects.toThrow('Item is not available')
  })

  it('should throw for insufficient stock', async () => {
    ;(prisma.shopItem.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 5,
      name: 'Rare Gem',
      price: 10,
      quantity: 1,
      isAvailable: true,
    })

    await expect(buyItem('buyer-1', 5, 5)).rejects.toThrow('Not enough stock')
  })

  it('should throw for insufficient funds', async () => {
    ;(prisma.shopItem.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 5,
      name: 'Cool Hat',
      price: 300,
      quantity: -1,
      isAvailable: true,
    })
    ;(getOrCreateEconomy as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'buyer-1', wallet: 50 })

    await expect(buyItem('buyer-1', 5)).rejects.toThrow('Insufficient funds')
  })

  it('should throw for non-positive quantity', async () => {
    await expect(buyItem('buyer-1', 5, 0)).rejects.toThrow('Quantity must be positive')
  })
})
