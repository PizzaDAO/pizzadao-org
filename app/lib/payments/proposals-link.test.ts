// @vitest-environment node
// Payments and proposals (proposals.enabled on): VOTE_REQUIRED links a passed in-app proposal, Sesh links and hand-typed
// counts stop mattering, and with proposals off everything behaves as before.
import { describe, expect, it } from 'vitest'
import { checkProposalLink, type LinkableProposal } from '@/app/lib/proposals/payment-link'
import { evaluateDecision } from './decide'
import { computeRuleFlags, type RuleContext } from './rules'
import { actor, policy, snapshot } from './test-utils'

const A = '200000000000000001'
const REQUESTER = '100000000000000001'
const p = policy()
const passed: LinkableProposal = { kind: 'FUNDING', status: 'PASSED', proposerDiscordId: REQUESTER, amountUsdCents: 100_000 }
const link = (over: Partial<Parameters<typeof checkProposalLink>[0]> = {}) => ({
  proposalId: 'prop12345', requesterDiscordId: REQUESTER, amountUsdCents: 100_000, capUsdCents: 62_500, ...over,
})

describe('request form: linking a proposal', () => {
  it('above the cap a passed proposal of the requester is required', () => {
    expect(checkProposalLink(link({ proposalId: null }), null, 0)).toBe('proposal_required')
    expect(checkProposalLink(link({ proposalId: null, amountUsdCents: 50_000 }), null, 0)).toBeNull()
    expect(checkProposalLink(link(), passed, 0)).toBeNull()
  })

  it('refuses a proposal that is not passed, not funding, not the requester\'s, or too small', () => {
    expect(checkProposalLink(link(), { ...passed, status: 'OPEN' }, 0)).toBe('proposal_invalid')
    expect(checkProposalLink(link(), { ...passed, status: 'FAILED' }, 0)).toBe('proposal_invalid')
    expect(checkProposalLink(link(), { ...passed, kind: 'GENERAL' }, 0)).toBe('proposal_invalid')
    expect(checkProposalLink(link(), { ...passed, proposerDiscordId: A }, 0)).toBe('proposal_invalid')
    expect(checkProposalLink(link(), null, 0)).toBe('proposal_invalid')
    expect(checkProposalLink(link({ amountUsdCents: 100_001 }), passed, 0)).toBe('proposal_invalid')
  })

  it('cannot fund more than the proposal passed for, across requests', () => {
    expect(checkProposalLink(link({ amountUsdCents: 40_000 }), passed, 60_000)).toBeNull()
    expect(checkProposalLink(link({ amountUsdCents: 40_001 }), passed, 60_000)).toBe('proposal_exhausted')
  })
})

describe('rule flags with proposals on', () => {
  const NOW = new Date('2026-11-10T12:00:00Z')
  const ctx = (req: Partial<RuleContext['req']>): RuleContext => ({
    now: NOW, policy: p, newAccountDays: 30,
    req: { source: 'APP', kind: 'EVENT_BUDGET', amountUsdCents: 100_000, currency: 'USD', eventDate: null, createdAt: NOW, rsvEventSlug: null, title: 't', proposalUrl: null, requesterDiscordId: REQUESTER, requesterMemberId: 'M-1', ...req },
    attachments: [], reusedAttachment: false, sharedPayee: false, sharedPayeeFormRow: false, repeatFormPayee: false, priorFraud: false,
    claimedFraudHint: false, restrictedMatches: [], restrictedCheckFailed: false, restrictedCheckOff: false, hashConfigured: true,
    rsvFlagged: false, newAccount: false, siblings: [],
  })
  const ids = (c: RuleContext) => computeRuleFlags(c).map((f) => f.id)

  it('a Sesh link no longer satisfies the vote rule', () => {
    expect(ids(ctx({ proposalUrl: 'https://example.com/poll', proposalsOn: true, proposal: null }))).toContain('over_cap_no_vote')
    // ...while with proposals off it still does
    expect(ids(ctx({ proposalUrl: 'https://example.com/poll' }))).not.toContain('over_cap_no_vote')
  })

  it('a passed linked proposal clears it; an unpassed one does not', () => {
    expect(ids(ctx({ proposalsOn: true, proposal: { status: 'PASSED', amountUsdCents: 100_000 } }))).toEqual([])
    expect(ids(ctx({ proposalsOn: true, proposal: { status: 'FAILED', amountUsdCents: 100_000 } }))).toContain('over_cap_no_vote')
  })

  it('flags a request for more than the proposal passed for', () => {
    const f = computeRuleFlags(ctx({ amountUsdCents: 120_000, proposalsOn: true, proposal: { status: 'PASSED', amountUsdCents: 100_000 } }))
    expect(f.find((x) => x.id === 'amount_over_proposal')?.severity).toBe('high')
  })
})

describe('approving a VOTE_REQUIRED request', () => {
  const big = (over = {}) => snapshot({ amountUsdCents: 100_000, lane: 'VOTE_REQUIRED', proposalsOn: true, ...over })
  const approve = (s: ReturnType<typeof snapshot>, extra = {}) => evaluateDecision(s, [], actor(A), { action: 'APPROVE', note: 'proposal checked', ...extra }, p)
  const code = (r: { ok: boolean } & { code?: string }) => (r.ok ? 'ok' : r.code)

  it('needs a linked proposal; a Sesh link and typed counts are ignored', () => {
    expect(code(approve(big({ proposalUrl: 'https://example.com/poll' }), { checklist: { proposalPassed: true }, ayesConfirmed: 99 }))).toBe('proposal_missing')
  })

  it('refuses an unpassed proposal and an amount above the proposal\'s', () => {
    expect(code(approve(big({ proposal: { id: 'x', status: 'OPEN', amountUsdCents: 100_000, ayes: 0 } })))).toBe('proposal_not_passed')
    expect(code(approve(big({ proposal: { id: 'x', status: 'PASSED', amountUsdCents: 90_000, ayes: 30 } })))).toBe('amount_over_proposal')
  })

  it('pre-fills the checklist from the tally, whatever the reviewer typed', () => {
    const r = approve(big({ proposal: { id: 'prop1', status: 'PASSED', amountUsdCents: 100_000, ayes: 31 } }), { checklist: { proposalPassed: false }, ayesConfirmed: 1 })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.checklist).toMatchObject({ proposalPassed: true, ayesConfirmed: 31, proposalId: 'prop1' })
  })

  it('with proposals off the old poll rules apply unchanged', () => {
    const off = snapshot({ amountUsdCents: 100_000, lane: 'VOTE_REQUIRED', proposalUrl: 'https://example.com/poll' })
    expect(code(approve(off))).toBe('proposal_unconfirmed')
    expect(approve(off, { checklist: { proposalPassed: true }, ayesConfirmed: 25 }).ok).toBe(true)
  })
})
