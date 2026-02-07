import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import { TransactionHistory } from '../TransactionHistory'

// Mock next/image used by PepIcon
vi.mock('next/image', () => ({
  __esModule: true,
  default: ({ alt, width, height, ...props }: any) => (
    <img alt={alt} width={width} height={height} {...props} />
  ),
}))

// ---- Test data ----

// Use a fixed point in time for deterministic relative timestamps
const FIXED_NOW = new Date('2026-02-07T12:00:00Z').getTime()

function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    type: 'BOUNTY_REWARD',
    amount: 100,
    balance: 1100,
    description: 'Bounty approved',
    createdAt: new Date(FIXED_NOW - 3600000).toISOString(), // 1h ago
    metadata: {},
    ...overrides,
  }
}

const SAMPLE_TRANSACTIONS = [
  makeTx({
    id: 1,
    type: 'BOUNTY_ESCROW',
    amount: -50,
    balance: 950,
    description: 'Created bounty: "Fix the homepage"',
    createdAt: new Date(FIXED_NOW - 300000).toISOString(), // 5m ago
    metadata: { bountyId: 1 },
  }),
  makeTx({
    id: 2,
    type: 'BOUNTY_REWARD',
    amount: 100,
    balance: 1100,
    description: 'Bounty approved: "Update docs"',
    createdAt: new Date(FIXED_NOW - 3600000).toISOString(), // 1h ago
    metadata: { bountyId: 2 },
  }),
  makeTx({
    id: 3,
    type: 'SHOP_PURCHASE',
    amount: -25,
    balance: 1075,
    description: 'Bought Pizza Hat x1',
    createdAt: new Date(FIXED_NOW - 7200000).toISOString(), // 2h ago
    metadata: { itemId: 3 },
  }),
  makeTx({
    id: 4,
    type: 'TRANSFER_SENT',
    amount: -10,
    balance: 1065,
    description: 'Sent to @user123',
    createdAt: new Date(FIXED_NOW - 86400000).toISOString(), // 1d ago
    metadata: {},
  }),
  makeTx({
    id: 5,
    type: 'JOB_REWARD',
    amount: 75,
    balance: 1140,
    description: 'Completed job: Weekly standup notes',
    createdAt: new Date(FIXED_NOW - 172800000).toISOString(), // 2d ago
    metadata: {},
  }),
]

// ---- Helpers ----

function mockFetchSuccess(transactions: unknown[], total: number) {
  ;(global.fetch as Mock).mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ transactions, total }),
  })
}

function mockFetchEmpty() {
  ;(global.fetch as Mock).mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ transactions: [], total: 0 }),
  })
}

function mockFetchError() {
  ;(global.fetch as Mock).mockRejectedValue(new Error('Network error'))
}

function mockFetchUnauthorized() {
  ;(global.fetch as Mock).mockResolvedValue({
    ok: false,
    status: 401,
    json: () => Promise.resolve({ error: 'Not authenticated' }),
  })
}

// ---- Tests ----

describe('TransactionHistory', () => {
  let dateNowSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    // Mock Date.now() to return a fixed value for deterministic relative timestamps
    dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW)
  })

  afterEach(() => {
    dateNowSpy.mockRestore()
    cleanup()
  })

  // ========================================
  // Rendering transactions
  // ========================================

  describe('rendering transactions', () => {
    it('renders a list of transactions when the API returns data', async () => {
      mockFetchSuccess(SAMPLE_TRANSACTIONS, 5)
      render(<TransactionHistory />)

      await waitFor(() => {
        expect(screen.getByText('Created bounty: "Fix the homepage"')).toBeInTheDocument()
      })

      expect(screen.getByText('Transaction History')).toBeInTheDocument()
      expect(screen.getByText('Bounty approved: "Update docs"')).toBeInTheDocument()
      expect(screen.getByText('Bought Pizza Hat x1')).toBeInTheDocument()
      expect(screen.getByText('Sent to @user123')).toBeInTheDocument()
      expect(screen.getByText('Completed job: Weekly standup notes')).toBeInTheDocument()
    })

    it('shows correct transaction type icons for all types', async () => {
      const allTypes = [
        makeTx({ id: 1, type: 'BOUNTY_ESCROW', amount: -50, description: 'Escrow tx' }),
        makeTx({ id: 2, type: 'BOUNTY_REWARD', amount: 100, description: 'Reward tx' }),
        makeTx({ id: 3, type: 'BOUNTY_REFUND', amount: 50, description: 'Refund tx' }),
        makeTx({ id: 4, type: 'SHOP_PURCHASE', amount: -25, description: 'Purchase tx' }),
        makeTx({ id: 5, type: 'JOB_REWARD', amount: 75, description: 'Job tx' }),
        makeTx({ id: 6, type: 'TRANSFER_SENT', amount: -10, description: 'Sent tx' }),
        makeTx({ id: 7, type: 'TRANSFER_RECEIVED', amount: 10, description: 'Received tx' }),
      ]
      mockFetchSuccess(allTypes, 7)
      render(<TransactionHistory />)

      await waitFor(() => {
        expect(screen.getByText('Escrow tx')).toBeInTheDocument()
      })

      // All 7 transaction descriptions should be rendered
      expect(screen.getByText('Reward tx')).toBeInTheDocument()
      expect(screen.getByText('Refund tx')).toBeInTheDocument()
      expect(screen.getByText('Purchase tx')).toBeInTheDocument()
      expect(screen.getByText('Job tx')).toBeInTheDocument()
      expect(screen.getByText('Sent tx')).toBeInTheDocument()
      expect(screen.getByText('Received tx')).toBeInTheDocument()

      // Each transaction row should have an SVG icon inside it
      const svgs = document.querySelectorAll('svg')
      expect(svgs.length).toBe(7)
    })

    it('shows positive amounts in green with "+" prefix for credits', async () => {
      const credits = [
        makeTx({ id: 1, type: 'BOUNTY_REWARD', amount: 100, description: 'Reward' }),
        makeTx({ id: 2, type: 'BOUNTY_REFUND', amount: 50, description: 'Refund' }),
        makeTx({ id: 3, type: 'JOB_REWARD', amount: 75, description: 'Job reward' }),
        makeTx({ id: 4, type: 'TRANSFER_RECEIVED', amount: 10, description: 'Received' }),
      ]
      mockFetchSuccess(credits, 4)
      render(<TransactionHistory />)

      await waitFor(() => {
        expect(screen.getByText('Reward')).toBeInTheDocument()
      })

      // The component uses #16a34a which is rgb(22, 163, 74)
      // Find amount divs by their green color and bold weight
      const amountDivs = document.querySelectorAll('div[style]')
      const greenAmounts: HTMLElement[] = []
      amountDivs.forEach((div) => {
        const el = div as HTMLElement
        if (el.style.color === 'rgb(22, 163, 74)' && el.style.fontWeight === '700') {
          greenAmounts.push(el)
        }
      })
      expect(greenAmounts.length).toBe(4)

      // Check that each green amount has "+" in its text content
      for (const el of greenAmounts) {
        expect(el.textContent).toMatch(/^\+/)
      }
    })

    it('shows negative amounts in red without "+" prefix for debits', async () => {
      const debits = [
        makeTx({ id: 1, type: 'BOUNTY_ESCROW', amount: -50, description: 'Escrow' }),
        makeTx({ id: 2, type: 'SHOP_PURCHASE', amount: -25, description: 'Purchase' }),
        makeTx({ id: 3, type: 'TRANSFER_SENT', amount: -10, description: 'Sent' }),
      ]
      mockFetchSuccess(debits, 3)
      render(<TransactionHistory />)

      await waitFor(() => {
        expect(screen.getByText('Escrow')).toBeInTheDocument()
      })

      // Find red-colored amount divs
      const amountDivs = document.querySelectorAll('div[style]')
      const redAmounts: HTMLElement[] = []
      amountDivs.forEach((div) => {
        const el = div as HTMLElement
        if (el.style.color === 'rgb(220, 38, 38)' && el.style.fontWeight === '700') {
          redAmounts.push(el)
        }
      })
      expect(redAmounts.length).toBe(3)

      // Check that none have "+" prefix and all have "-" (from toLocaleString on negative numbers)
      for (const el of redAmounts) {
        expect(el.textContent).not.toMatch(/^\+/)
        expect(el.textContent).toMatch(/^-/)
      }
    })

    it('shows the transaction description text', async () => {
      mockFetchSuccess(SAMPLE_TRANSACTIONS, 5)
      render(<TransactionHistory />)

      await waitFor(() => {
        expect(screen.getByText('Created bounty: "Fix the homepage"')).toBeInTheDocument()
      })

      expect(screen.getByText('Bounty approved: "Update docs"')).toBeInTheDocument()
      expect(screen.getByText('Bought Pizza Hat x1')).toBeInTheDocument()
      expect(screen.getByText('Sent to @user123')).toBeInTheDocument()
      expect(screen.getByText('Completed job: Weekly standup notes')).toBeInTheDocument()
    })

    it('shows relative timestamps', async () => {
      // Use real Date.now() for this test so the component's `new Date()`
      // in formatRelativeTime produces correct relative offsets
      dateNowSpy.mockRestore()
      const realNow = Date.now()

      const timestampedTxs = [
        makeTx({ id: 1, type: 'BOUNTY_ESCROW', amount: -50, description: 'Tx 5m', createdAt: new Date(realNow - 300000).toISOString() }),
        makeTx({ id: 2, type: 'BOUNTY_REWARD', amount: 100, description: 'Tx 1h', createdAt: new Date(realNow - 3600000).toISOString() }),
        makeTx({ id: 3, type: 'SHOP_PURCHASE', amount: -25, description: 'Tx 2h', createdAt: new Date(realNow - 7200000).toISOString() }),
        makeTx({ id: 4, type: 'TRANSFER_SENT', amount: -10, description: 'Tx 1d', createdAt: new Date(realNow - 86400000).toISOString() }),
        makeTx({ id: 5, type: 'JOB_REWARD', amount: 75, description: 'Tx 2d', createdAt: new Date(realNow - 172800000).toISOString() }),
      ]
      mockFetchSuccess(timestampedTxs, 5)
      render(<TransactionHistory />)

      await waitFor(() => {
        expect(screen.getByText('5m ago')).toBeInTheDocument()
      })

      expect(screen.getByText('1h ago')).toBeInTheDocument()
      expect(screen.getByText('2h ago')).toBeInTheDocument()
      expect(screen.getByText('1d ago')).toBeInTheDocument()
      expect(screen.getByText('2d ago')).toBeInTheDocument()
    })
  })

  // ========================================
  // Empty state
  // ========================================

  describe('empty state', () => {
    it('shows empty state message when no transactions exist', async () => {
      mockFetchEmpty()
      render(<TransactionHistory />)

      await waitFor(() => {
        expect(screen.getByText(/No transactions yet/)).toBeInTheDocument()
      })
      expect(screen.getByText(/Earn, spend, or transfer/)).toBeInTheDocument()
    })

    it('shows empty state when API returns empty array', async () => {
      mockFetchSuccess([], 0)
      render(<TransactionHistory />)

      await waitFor(() => {
        expect(screen.getByText(/No transactions yet/)).toBeInTheDocument()
      })
    })
  })

  // ========================================
  // Pagination
  // ========================================

  describe('pagination', () => {
    it('shows "Load more" button when there are more transactions than current page', async () => {
      mockFetchSuccess(SAMPLE_TRANSACTIONS, 8)
      render(<TransactionHistory />)

      await waitFor(() => {
        expect(screen.getByText('Load more')).toBeInTheDocument()
      })
    })

    it('clicking "Load more" fetches next page and appends to list', async () => {
      // First fetch: 5 transactions, total of 8
      ;(global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ transactions: SAMPLE_TRANSACTIONS, total: 8 }),
      })

      render(<TransactionHistory />)

      await waitFor(() => {
        expect(screen.getByText('Load more')).toBeInTheDocument()
      })

      // Set up next page response
      const page2Transactions = [
        makeTx({ id: 6, type: 'TRANSFER_RECEIVED', amount: 20, description: 'Received from @friend', createdAt: new Date(FIXED_NOW - 259200000).toISOString() }),
        makeTx({ id: 7, type: 'BOUNTY_REFUND', amount: 30, description: 'Bounty refunded', createdAt: new Date(FIXED_NOW - 345600000).toISOString() }),
        makeTx({ id: 8, type: 'JOB_REWARD', amount: 50, description: 'Completed job: Design review', createdAt: new Date(FIXED_NOW - 432000000).toISOString() }),
      ]
      ;(global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ transactions: page2Transactions, total: 8 }),
      })

      // Click Load more
      await act(async () => {
        fireEvent.click(screen.getByText('Load more'))
      })

      // Wait for the new transactions to appear
      await waitFor(() => {
        expect(screen.getByText('Received from @friend')).toBeInTheDocument()
      })

      // Verify offset was passed correctly: offset=5 (the length of current transactions)
      const calls = (global.fetch as Mock).mock.calls
      expect(calls[1][0]).toContain('offset=5')

      // New transactions should be appended
      expect(screen.getByText('Bounty refunded')).toBeInTheDocument()
      expect(screen.getByText('Completed job: Design review')).toBeInTheDocument()

      // Original transactions should still be present
      expect(screen.getByText('Created bounty: "Fix the homepage"')).toBeInTheDocument()
    })

    it('hides "Load more" when all transactions have been loaded', async () => {
      // total matches the number of transactions returned
      mockFetchSuccess(SAMPLE_TRANSACTIONS, 5)
      render(<TransactionHistory />)

      // Wait for transactions to render
      await waitFor(() => {
        expect(screen.getByText('Created bounty: "Fix the homepage"')).toBeInTheDocument()
      })

      expect(screen.queryByText('Load more')).not.toBeInTheDocument()
    })
  })

  // ========================================
  // Refresh behavior
  // ========================================

  describe('refresh behavior', () => {
    it('re-fetches transactions when refreshKey prop changes', async () => {
      mockFetchSuccess(SAMPLE_TRANSACTIONS, 5)

      const { rerender } = render(<TransactionHistory refreshKey={0} />)

      // Wait for initial fetch to complete
      await waitFor(() => {
        expect(screen.getByText('Created bounty: "Fix the homepage"')).toBeInTheDocument()
      })

      expect((global.fetch as Mock).mock.calls.length).toBe(1)

      // Set up the response for the second fetch
      const updatedTransactions = [
        ...SAMPLE_TRANSACTIONS,
        makeTx({ id: 6, type: 'SHOP_PURCHASE', amount: -15, description: 'Bought Pizza Slice x1' }),
      ]
      ;(global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ transactions: updatedTransactions, total: 6 }),
      })

      // Rerender with new refreshKey
      await act(async () => {
        rerender(<TransactionHistory refreshKey={1} />)
      })

      // Wait for the new transaction to appear
      await waitFor(() => {
        expect(screen.getByText('Bought Pizza Slice x1')).toBeInTheDocument()
      })

      // Should have fetched again
      expect((global.fetch as Mock).mock.calls.length).toBe(2)
    })
  })

  // ========================================
  // Error handling
  // ========================================

  describe('error handling', () => {
    it('handles API errors gracefully (does not crash)', async () => {
      mockFetchError()
      render(<TransactionHistory />)

      // Component should still render the heading (it catches errors silently)
      // and loading state should eventually resolve to empty state
      await waitFor(() => {
        expect(screen.getByText(/No transactions yet/)).toBeInTheDocument()
      })

      expect(screen.getByText('Transaction History')).toBeInTheDocument()
    })

    it('handles unauthenticated state gracefully', async () => {
      mockFetchUnauthorized()
      render(<TransactionHistory />)

      // Component checks res.ok and returns early - no crash
      // Loading state should resolve to empty state
      await waitFor(() => {
        expect(screen.getByText(/No transactions yet/)).toBeInTheDocument()
      })

      expect(screen.getByText('Transaction History')).toBeInTheDocument()
    })
  })
})
