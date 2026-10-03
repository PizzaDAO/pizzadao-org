import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buyItem, syncShopItemsFromData } from './shop'
import { prisma } from './db'

vi.mock('./db')
vi.mock('./economy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./economy')>()),
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

const mockFn = (f: unknown) => f as ReturnType<typeof vi.fn>

function txClient({ debitCount = 1, stockCount = 1 } = {}) {
  return {
    economy: { updateMany: vi.fn().mockResolvedValue({ count: debitCount }), update: vi.fn() },
    shopItem: { updateMany: vi.fn().mockResolvedValue({ count: stockCount }), update: vi.fn() },
    inventory: { upsert: vi.fn().mockResolvedValue({}) },
  }
}

function runTx(tx: ReturnType<typeof txClient>) {
  mockFn(prisma.$transaction).mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx))
}

const ITEM = { id: 5, name: 'Cool Hat', price: 30, quantity: -1, isAvailable: true }

describe('buyItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFn(getOrCreateEconomy).mockResolvedValue({ id: 'buyer-1', wallet: 200 })
  })

  it('debits conditionally and logs SHOP_PURCHASE in the same DB transaction', async () => {
    mockFn(prisma.shopItem.findUnique).mockResolvedValue(ITEM)
    const tx = txClient()
    runTx(tx)

    const result = await buyItem('buyer-1', 5, 2)

    expect(result).toEqual({ success: true, item: 'Cool Hat', quantity: 2, totalCost: 60 })
    expect(tx.economy.updateMany).toHaveBeenCalledWith({
      where: { id: 'buyer-1', wallet: { gte: 60 } },
      data: { wallet: { decrement: 60 } },
    })
    expect(tx.economy.update).not.toHaveBeenCalled() // never an unconditional debit
    expect(logTransaction).toHaveBeenCalledWith(
      tx,
      'buyer-1',
      'SHOP_PURCHASE',
      -60,
      'Purchased 2x Cool Hat',
      { itemId: 5, itemName: 'Cool Hat', quantity: 2 }
    )
    expect(tx.inventory.upsert).toHaveBeenCalled()
  })

  it('fails (and rolls back) when a concurrent purchase drained the wallet after the pre-check', async () => {
    mockFn(prisma.shopItem.findUnique).mockResolvedValue(ITEM)
    const tx = txClient({ debitCount: 0 })
    runTx(tx)

    await expect(buyItem('buyer-1', 5, 1)).rejects.toThrow('Insufficient funds')
    expect(tx.inventory.upsert).not.toHaveBeenCalled()
    expect(logTransaction).not.toHaveBeenCalled()
  })

  it('decrements limited stock conditionally and fails when it sold out concurrently', async () => {
    mockFn(prisma.shopItem.findUnique).mockResolvedValue({ ...ITEM, quantity: 3 })
    const tx = txClient({ stockCount: 0 })
    runTx(tx)

    await expect(buyItem('buyer-1', 5, 1)).rejects.toThrow('Not enough stock')
    expect(tx.shopItem.updateMany).toHaveBeenCalledWith({
      where: { id: 5, isAvailable: true, quantity: { gte: 1 } },
      data: { quantity: { decrement: 1 } },
    })
    expect(tx.inventory.upsert).not.toHaveBeenCalled()
  })

  it('refuses items with a non-positive price (would mint PEP)', async () => {
    mockFn(prisma.shopItem.findUnique).mockResolvedValue({ ...ITEM, price: -50 })
    await expect(buyItem('buyer-1', 5, 1)).rejects.toThrow('Item is not available')
    mockFn(prisma.shopItem.findUnique).mockResolvedValue({ ...ITEM, price: 0 })
    await expect(buyItem('buyer-1', 5, 1)).rejects.toThrow('Item is not available')
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('should throw for non-existent item', async () => {
    mockFn(prisma.shopItem.findUnique).mockResolvedValue(null)
    await expect(buyItem('buyer-1', 999)).rejects.toThrow('Item not found')
  })

  it('should throw for unavailable item', async () => {
    mockFn(prisma.shopItem.findUnique).mockResolvedValue({ ...ITEM, isAvailable: false })
    await expect(buyItem('buyer-1', 5)).rejects.toThrow('Item is not available')
  })

  it('should throw for insufficient stock', async () => {
    mockFn(prisma.shopItem.findUnique).mockResolvedValue({ ...ITEM, name: 'Rare Gem', price: 10, quantity: 1 })
    await expect(buyItem('buyer-1', 5, 5)).rejects.toThrow('Not enough stock')
  })

  it('should throw for insufficient funds', async () => {
    mockFn(prisma.shopItem.findUnique).mockResolvedValue({ ...ITEM, price: 300 })
    mockFn(getOrCreateEconomy).mockResolvedValue({ id: 'buyer-1', wallet: 50 })
    await expect(buyItem('buyer-1', 5)).rejects.toThrow('Insufficient funds')
  })

  it('rejects non-positive and fractional quantities', async () => {
    await expect(buyItem('buyer-1', 5, 0)).rejects.toThrow('Quantity must be a positive whole number')
    await expect(buyItem('buyer-1', 5, 1.5)).rejects.toThrow('Quantity must be a positive whole number')
  })
})

describe('syncShopItemsFromData', () => {
  beforeEach(() => vi.clearAllMocks())

  it('skips rows with a zero, negative or fractional price', async () => {
    mockFn(prisma.shopItem.findMany).mockResolvedValue([])
    mockFn(prisma.shopItem.create).mockResolvedValue({})

    const result = await syncShopItemsFromData([
      { name: 'Free lunch', price: 0 },
      { name: 'Negative', price: -10 },
      { name: 'Fraction', price: 1.5 },
      { name: 'Fine', price: 10 },
    ])

    expect(result.added).toBe(1)
    expect(prisma.shopItem.create).toHaveBeenCalledTimes(1)
    expect(mockFn(prisma.shopItem.create).mock.calls[0][0].data.name).toBe('Fine')
  })
})
