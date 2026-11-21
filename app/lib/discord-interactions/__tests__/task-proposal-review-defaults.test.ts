import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/call-tasks/apply', () => ({ applyProposal: vi.fn(async () => ({ result: 'applied', taskId: 't1' })), dismissProposal: vi.fn(async () => 'dismissed') }))
vi.mock('@/app/lib/call-tasks/cards', () => ({
  loadProposalCardView: vi.fn(),
  proposalCardState: vi.fn(),
  proposalCardsEnabled: vi.fn(),
  proposalReviewUrl: vi.fn(),
  syncTaskProposalCard: vi.fn(async () => 'edited'),
  defaultProposalCardDeps: {},
}))
vi.mock('@/app/lib/calls/review-role', () => ({ callReviewRole: vi.fn() }))
vi.mock('../call-review-defaults', () => ({ editOriginalReply: vi.fn() }))

import { applyProposal, dismissProposal } from '@/app/lib/call-tasks/apply'
import { loadProposalCardView, syncTaskProposalCard } from '@/app/lib/call-tasks/cards'
import { loadProposalReviewTarget, taskProposalRunDeps } from '../task-proposal-review-defaults'

describe('task proposal buttons: the real deps go through the website code', () => {
  it('apply and dismiss call applyProposal / dismissProposal with the reviewer check in place of the crew-lead check', async () => {
    const deps = taskProposalRunDeps()
    await deps.apply('p1', 'u1', true)
    const opts = vi.mocked(applyProposal).mock.calls[0][2] as { confirmed: boolean; force?: boolean; edits?: unknown; authorize: (a: string, c: string) => Promise<boolean> }
    expect(opts.confirmed).toBe(true)
    expect(opts.force).toBeUndefined()
    expect(opts.edits).toBeUndefined()
    expect(await opts.authorize('u1', 'ops')).toBe(true)
    await deps.dismiss('p1', 'u1')
    expect(vi.mocked(dismissProposal).mock.calls[0][0]).toBe('p1')
    expect(typeof (vi.mocked(dismissProposal).mock.calls[0][3] as { authorize?: unknown }).authorize).toBe('function')
  })

  it('the handler target is the lean load (inside the 3 s window)', async () => {
    vi.mocked(loadProposalCardView).mockResolvedValue(null)
    expect(await loadProposalReviewTarget('p1', 'https://app.example.test')).toBeNull()
    expect(vi.mocked(loadProposalCardView)).toHaveBeenCalledWith('p1', { lean: true })
  })

  it('the card refresh only edits (never posts)', async () => {
    await taskProposalRunDeps().syncCard('p1')
    expect(vi.mocked(syncTaskProposalCard).mock.calls[0][2]).toEqual({ editOnly: true })
  })
})
