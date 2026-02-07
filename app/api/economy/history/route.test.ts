import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock session and transactions before importing the route
vi.mock('@/app/lib/session', () => ({
  getSession: vi.fn(),
}))

vi.mock('@/app/lib/transactions', () => ({
  getTransactionHistory: vi.fn(),
}))

import { GET } from './route'
import { getSession } from '@/app/lib/session'
import { getTransactionHistory } from '@/app/lib/transactions'
import { NextRequest } from 'next/server'

function createRequest(url: string): NextRequest {
  return new NextRequest(new URL(url, 'http://localhost:3000'))
}

describe('GET /api/economy/history', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 401 when not authenticated', async () => {
    ;(getSession as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    const res = await GET(createRequest('/api/economy/history'))
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toBe('Not authenticated')
  })

  it('should return transactions and total for authenticated user', async () => {
    ;(getSession as ReturnType<typeof vi.fn>).mockResolvedValue({ discordId: 'user-1' })

    const mockTransactions = [
      { id: 1, type: 'JOB_REWARD', amount: 50, balance: 50, description: 'Job reward', createdAt: '2025-01-01T00:00:00Z' },
    ]
    ;(getTransactionHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      transactions: mockTransactions,
      total: 1,
    })

    const res = await GET(createRequest('/api/economy/history'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.transactions).toEqual(mockTransactions)
    expect(body.total).toBe(1)
    expect(getTransactionHistory).toHaveBeenCalledWith('user-1', 20, 0)
  })

  it('should parse limit and offset from query params', async () => {
    ;(getSession as ReturnType<typeof vi.fn>).mockResolvedValue({ discordId: 'user-1' })
    ;(getTransactionHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      transactions: [],
      total: 0,
    })

    await GET(createRequest('/api/economy/history?limit=10&offset=5'))

    expect(getTransactionHistory).toHaveBeenCalledWith('user-1', 10, 5)
  })

  it('should clamp limit to range [1, 100]', async () => {
    ;(getSession as ReturnType<typeof vi.fn>).mockResolvedValue({ discordId: 'user-1' })
    ;(getTransactionHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      transactions: [],
      total: 0,
    })

    // Test upper clamp
    await GET(createRequest('/api/economy/history?limit=500'))
    expect(getTransactionHistory).toHaveBeenCalledWith('user-1', 100, 0)

    vi.clearAllMocks()
    ;(getSession as ReturnType<typeof vi.fn>).mockResolvedValue({ discordId: 'user-1' })
    ;(getTransactionHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      transactions: [],
      total: 0,
    })

    // Test lower clamp
    await GET(createRequest('/api/economy/history?limit=-5'))
    expect(getTransactionHistory).toHaveBeenCalledWith('user-1', 1, 0)
  })

  it('should clamp negative offset to 0', async () => {
    ;(getSession as ReturnType<typeof vi.fn>).mockResolvedValue({ discordId: 'user-1' })
    ;(getTransactionHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      transactions: [],
      total: 0,
    })

    await GET(createRequest('/api/economy/history?offset=-10'))

    expect(getTransactionHistory).toHaveBeenCalledWith('user-1', 20, 0)
  })

  it('should return 400 when getTransactionHistory throws', async () => {
    ;(getSession as ReturnType<typeof vi.fn>).mockResolvedValue({ discordId: 'user-1' })
    ;(getTransactionHistory as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Database error'))

    const res = await GET(createRequest('/api/economy/history'))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('Database error')
  })
})
