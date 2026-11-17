import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock session and transactions before importing the route
vi.mock('@/app/lib/session', () => ({
  getSession: vi.fn(),
}))

vi.mock('@/app/lib/transactions', () => ({
  getTransactionHistory: vi.fn(),
}))

vi.mock('@/app/lib/member-names', async (orig) => ({
  ...(await orig<typeof import('@/app/lib/member-names')>()),
  memberNamesByDiscordId: vi.fn(async () => new Map()),
}))
vi.mock('@/app/lib/discord-channels', async (orig) => ({
  ...(await orig<typeof import('@/app/lib/discord-channels')>()),
  getGuildMemberCleanName: vi.fn(async () => null),
}))

import { GET } from './route'
import { getSession } from '@/app/lib/session'
import { getTransactionHistory } from '@/app/lib/transactions'
import { NextRequest } from 'next/server'
import { memberNamesByDiscordId } from '@/app/lib/member-names'
import { getGuildMemberCleanName } from '@/app/lib/discord-channels'

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

  it('resolves Discord mentions referenced in the returned memos', async () => {
    ;(getSession as ReturnType<typeof vi.fn>).mockResolvedValue({ discordId: 'user-1' })
    ;(getTransactionHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      transactions: [
        { id: 1, type: 'JOB_REWARD', amount: 50, balance: 50, description: 'Job reward: Clean <#123456789012345678> now', createdAt: '2025-01-01T00:00:00Z' },
      ],
      total: 1,
    })

    const res = await GET(createRequest('/api/economy/history'))
    const body = await res.json()

    expect(res.status).toBe(200)
    // No bot token configured in tests, so the mention resolves to {} —
    // the fields are present regardless, for TransactionHistory to render with.
    expect(body.channels).toEqual({})
    expect(body.roles).toEqual({})
    expect(body).toHaveProperty('guildId')
  })

  it('names the counterparty of transfers: member name, cleaned guild name, then "a member"', async () => {
    const M = '100000000000000001' // app member
    const G = '100000000000000002' // guild member only
    const X = '100000000000000003' // unknown
    ;(getSession as ReturnType<typeof vi.fn>).mockResolvedValue({ discordId: 'user-1' })
    ;(getTransactionHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
      transactions: [
        { id: 1, type: 'TRANSFER_SENT', amount: -5, balance: 5, description: `Transfer to ${M}`, createdAt: '2025-01-01T00:00:00Z', metadata: { toUserId: M } },
        { id: 2, type: 'TRANSFER_RECEIVED', amount: 5, balance: 10, description: `Transfer from ${G}`, createdAt: '2025-01-01T00:00:00Z', metadata: { fromUserId: G } },
        { id: 3, type: 'TRANSFER_RECEIVED', amount: 5, balance: 15, description: `Transfer from ${X}`, createdAt: '2025-01-01T00:00:00Z', metadata: { fromUserId: X } },
        { id: 4, type: 'TRANSFER_RECEIVED', amount: 5, balance: 20, description: 'Transfer from 42', createdAt: '2025-01-01T00:00:00Z', metadata: null },
        { id: 5, type: 'JOB_REWARD', amount: 50, balance: 70, description: 'Daily job: Do it', createdAt: '2025-01-01T00:00:00Z', metadata: {} },
      ],
      total: 5,
    })
    ;(memberNamesByDiscordId as ReturnType<typeof vi.fn>).mockResolvedValue(new Map([[M, { name: 'Member One', memberId: 'm-1' }]]))
    ;(getGuildMemberCleanName as ReturnType<typeof vi.fn>).mockImplementation(async (id: string) => (id === G ? 'Guild Two' : null))

    const body = await (await GET(createRequest('/api/economy/history'))).json()

    expect(body.transactions[0]).toMatchObject({ counterpartName: 'Member One', counterpartMemberId: 'm-1' })
    expect(body.transactions[1]).toMatchObject({ counterpartName: 'Guild Two', counterpartMemberId: null })
    expect(body.transactions[2]).toMatchObject({ counterpartName: 'a member', counterpartMemberId: null })
    // Legacy row with a short member number and non-transfer rows are left alone.
    expect(body.transactions[3]).not.toHaveProperty('counterpartName')
    expect(body.transactions[4]).not.toHaveProperty('counterpartName')
    expect(body.transactions[3].description).toBe('Transfer from 42')
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
