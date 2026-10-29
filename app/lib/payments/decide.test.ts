// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: { $transaction: vi.fn(), paymentRequest: {}, paymentDecision: {}, accountSignal: {} } }))

import { prisma } from '@/app/lib/db'
import { applyDecision, countApprovals, evaluateDecision, setUsdAmount, validProofRef } from './decide'
import { hashPayee } from './hash'
import { actor, DPR, policy, snapshot } from './test-utils'
import type { PaymentFlag } from './types'

const p = policy()
const A = '200000000000000001'
const B = '200000000000000002'
const flag = (over: Partial<PaymentFlag> = {}): PaymentFlag => ({ id: 'f1', severity: 'medium', detail: 'x', source: 'rules', ...over })
const ok = <T extends { ok: boolean }>(r: T) => {
  expect(r.ok).toBe(true)
  return r as Extract<T, { ok: true }>
}
const code = (r: { ok: boolean } & { code?: string }) => (r.ok ? 'ok' : r.code)

describe('evaluateDecision: approvals', () => {
  it('a standard request is approved by one reviewer', () => {
    const r = ok(evaluateDecision(snapshot(), [], actor(A), { action: 'APPROVE' }, p))
    expect(r.nextStatus).toBe('APPROVED')
  })

  it('blocks self-approval by Discord id and by a linked account', () => {
    const me = '100000000000000001'
    expect(code(evaluateDecision(snapshot(), [], actor(me), { action: 'APPROVE' }, p))).toBe('self_review')
    expect(code(evaluateDecision(snapshot({ linkedDiscordIds: [A] }), [], actor(A), { action: 'APPROVE' }, p))).toBe('self_review')
    expect(code(evaluateDecision(snapshot(), [], actor(me, { isDpr: true, canMarkPaid: true }), { action: 'REJECT', note: 'no' }, p))).toBe('self_review')
  })

  it('non-reviewers are refused', () => {
    expect(code(evaluateDecision(snapshot(), [], actor(A, { canReview: false }), { action: 'APPROVE' }, p))).toBe('forbidden')
  })

  it('counts distinct approvers; the same person twice does not count', () => {
    const risky = snapshot({ lane: 'HIGH_RISK', riskScore: 60, approvalsNeeded: 2 })
    const first = ok(evaluateDecision(risky, [], actor(A), { action: 'APPROVE', note: 'checked it' }, p))
    expect(first.nextStatus).toBe('RECEIVED')
    expect(first.awaiting).toBe('more_approvals')
    const prior = [{ action: 'APPROVE', actorDiscordId: A, actorIsDpr: false }]
    expect(code(evaluateDecision(risky, prior, actor(A), { action: 'APPROVE', note: 'again' }, p))).toBe('already_approved')
  })

  it('high risk needs enough approvers AND the top role', () => {
    const risky = snapshot({ lane: 'HIGH_RISK', riskScore: 60, approvalsNeeded: 2 })
    const prior = [{ action: 'APPROVE', actorDiscordId: A, actorIsDpr: false }]
    const second = ok(evaluateDecision(risky, prior, actor(B), { action: 'APPROVE', note: 'second look' }, p))
    expect(second.nextStatus).toBe('RECEIVED')
    expect(second.awaiting).toBe('top_role')
    const withDpr = ok(evaluateDecision(risky, prior, DPR(), { action: 'APPROVE', note: 'top role ok' }, p))
    expect(withDpr.nextStatus).toBe('APPROVED')
  })

  it('a hard-block flag is high risk even with a low score', () => {
    const f = flag({ id: 'reused_attachment', severity: 'high', hardBlock: true })
    const r = ok(evaluateDecision(snapshot({ flags: [f], riskScore: 50, approvalsNeeded: 2 }), [], actor(A), { action: 'APPROVE', ackFlagIds: ['reused_attachment'], note: 'seen' }, p))
    expect(r.nextStatus).toBe('RECEIVED')
  })

  it('approvals reset after an info request, a reject or a reopen', () => {
    const d = (action: string, a = A) => ({ action, actorDiscordId: a, actorIsDpr: false })
    expect(countApprovals([d('APPROVE'), d('REQUEST_INFO', B)]).actors.size).toBe(0)
    expect(countApprovals([d('APPROVE'), d('REQUEST_INFO', B), d('APPROVE', B)]).actors.size).toBe(1)
    expect(countApprovals([d('APPROVE'), d('REJECT', B), d('REOPEN', B)]).actors.size).toBe(0)
  })

  it('every open flag must be ticked off, and a note is required for medium or high flags', () => {
    const s = snapshot({ flags: [flag({ id: 'no_receipts' }), flag({ id: 'note_only', severity: 'info' })] })
    expect(code(evaluateDecision(s, [], actor(A), { action: 'APPROVE', note: 'fine' }, p))).toBe('flags_not_acknowledged')
    expect(code(evaluateDecision(s, [], actor(A), { action: 'APPROVE', ackFlagIds: ['no_receipts'] }, p))).toBe('note_required')
    expect(ok(evaluateDecision(s, [], actor(A), { action: 'APPROVE', ackFlagIds: ['no_receipts'], note: 'receipt seen by email' }, p)).nextStatus).toBe('APPROVED')
  })

  it('a restricted (disavow-list) flag can only be handled by the top role', () => {
    const f = flag({ id: 'restricted_list', severity: 'high', hardBlock: true, restricted: true })
    const s = snapshot({ flags: [f], riskScore: 50, approvalsNeeded: 2 })
    const input = { action: 'APPROVE' as const, ackFlagIds: ['restricted_list'], note: 'reviewed' }
    expect(code(evaluateDecision(s, [], actor(A), input, p))).toBe('restricted')
    expect(code(evaluateDecision(s, [], actor(A), { action: 'REJECT', note: 'no' }, p))).toBe('restricted')
    expect(ok(evaluateDecision(s, [], DPR(), input, p)).awaiting).toBe('more_approvals')
  })

  it('only a RECEIVED request can be approved', () => {
    for (const status of ['NEEDS_INFO', 'APPROVED', 'PAID', 'REJECTED', 'WITHDRAWN'] as const) {
      expect(code(evaluateDecision(snapshot({ status }), [], actor(A), { action: 'APPROVE' }, p))).toBe('bad_state')
    }
  })
})

describe('evaluateDecision: checks, claims and resets', () => {
  const NOW = new Date('2026-11-05T00:00:00Z')
  it('approval is refused until a check has run (a new file clears checkedAt)', () => {
    expect(code(evaluateDecision(snapshot({ checkedAt: null }), [], actor(A), { action: 'APPROVE' }, p))).toBe('not_checked')
    expect(code(evaluateDecision(snapshot({ checkedAt: null, checkMarker: null }), [], actor(A), { action: 'APPROVE' }, p))).toBe('not_checked')
  })

  it('a file that arrives while a check is running: the check did not see it, so approval is refused until a new check', () => {
    // The check recorded 1 file; by the time of the decision there are 2 (checkedAt is set, from the in-flight check).
    const raced = snapshot({ checkedAt: NOW, checkMarker: { attachments: '1:2026-11-04T00:00:00.000Z', approvals: 0 }, currentMarker: { attachments: '2:2026-11-05T00:00:00.000Z', approvals: 0 } })
    expect(code(evaluateDecision(raced, [], actor(A), { action: 'APPROVE' }, p))).toBe('not_checked')
    // After a new check has seen both files, approval works. No clock comparison is involved.
    const rechecked = snapshot({ checkedAt: new Date('2026-01-01T00:00:00Z'), checkMarker: { attachments: '2:2026-11-05T00:00:00.000Z', approvals: 0 }, currentMarker: { attachments: '2:2026-11-05T00:00:00.000Z', approvals: 0 } })
    expect(ok(evaluateDecision(rechecked, [], actor(A), { action: 'APPROVE' }, p)).nextStatus).toBe('APPROVED')
  })

  it('approval is refused while the restricted-list check could not run', () => {
    const s = snapshot({ flags: [flag({ id: 'restricted_check_failed' })] })
    expect(code(evaluateDecision(s, [], actor(A), { action: 'APPROVE', ackFlagIds: ['restricted_check_failed'], note: 'seen it' }, p))).toBe('check_failed')
  })

  it('the id claimed on a public form counts as the requester for the self-approval check', () => {
    const s = snapshot({ requesterDiscordId: null, claimedDiscordId: A })
    expect(code(evaluateDecision(s, [], actor(A), { action: 'APPROVE', ackFlagIds: [], note: 'x' }, p))).toBe('self_review')
    expect(code(evaluateDecision(s, [], actor(A), { action: 'REJECT', note: 'no' }, p))).toBe('self_review')
  })

  it('a form row has no requester who can withdraw or reply (a claim is not an identity)', () => {
    const s = snapshot({ requesterDiscordId: null, claimedDiscordId: A })
    expect(code(evaluateDecision(s, [], actor(A, { canReview: false }), { action: 'WITHDRAW' }, p))).toBe('not_requester')
  })

  it('a system reset (flags or lane changed) wipes earlier approvals', () => {
    const d = (action: string, a = A) => ({ action, actorDiscordId: a, actorIsDpr: false })
    expect(countApprovals([d('APPROVE'), d('SYSTEM_RESET', 'system')]).actors.size).toBe(0)
    expect(countApprovals([d('APPROVE'), d('SYSTEM_RESET', 'system'), d('APPROVE', B)]).actors.size).toBe(1)
    expect(code(evaluateDecision(snapshot(), [], actor(A), { action: 'SYSTEM_RESET' as never }, p))).toBe('unknown_action')
  })
})

describe('evaluateDecision: marking paid', () => {
  const ENV = { PAYMENTS_HASH_SECRET: 'test-secret-value' } as unknown as NodeJS.ProcessEnv
  const PAYEE = '0x1234567890abcdef1234567890abcdef12345678'
  const base = (over = {}) => snapshot({ status: 'APPROVED', checkedAt: new Date('2026-11-04T00:00:00Z'), checkMarker: { attachments: '0:', approvals: 1 }, currentMarker: { attachments: '0:', approvals: 1 }, payeeHash: hashPayee(PAYEE, ENV), ...over })
  const pay = { action: 'MARK_PAID' as const, proofRef: '0xabc123abc123', paidTo: PAYEE }

  it('needs a check that saw every approval and every file', () => {
    expect(code(evaluateDecision(base({ checkMarker: { attachments: '0:', approvals: 0 } }), [], DPR(), pay, p, ENV))).toBe('recheck_required')
    expect(code(evaluateDecision(base({ checkMarker: { attachments: '0:', approvals: 1 }, currentMarker: { attachments: '1:2026-11-05T00:00:00.000Z', approvals: 1 } }), [], DPR(), pay, p, ENV))).toBe('recheck_required')
    expect(code(evaluateDecision(base({ checkedAt: null }), [], DPR(), pay, p, ENV))).toBe('recheck_required')
    expect(ok(evaluateDecision(base(), [], DPR(), pay, p, ENV)).nextStatus).toBe('PAID')
  })

  it('shows today\'s flags again: every open flag must be ticked off, with a note', () => {
    const s = base({ flags: [flag({ id: 'new_account' })] })
    expect(code(evaluateDecision(s, [], DPR(), pay, p, ENV))).toBe('flags_not_acknowledged')
    expect(code(evaluateDecision(s, [], DPR(), { ...pay, ackFlagIds: ['new_account'] }, p, ENV))).toBe('note_required')
    expect(ok(evaluateDecision(s, [], DPR(), { ...pay, ackFlagIds: ['new_account'], note: 'looked again' }, p, ENV)).nextStatus).toBe('PAID')
  })

  it('compares what was paid with the payee on the request, and never keeps it', () => {
    const r = ok(evaluateDecision(base(), [], DPR(), pay, p, ENV))
    expect(r.checklist.payeeChecked).toBe('match')
    expect(JSON.stringify(r)).not.toContain(PAYEE)
    expect(code(evaluateDecision(base(), [], DPR(), { ...pay, paidTo: '0x0000000000000000000000000000000000000009' }, p, ENV))).toBe('payee_mismatch')
    expect(code(evaluateDecision(base(), [], DPR(), { ...pay, paidTo: undefined }, p, ENV))).toBe('paid_to_required')
    expect(code(evaluateDecision(base(), [], DPR(), pay, p, {} as never))).toBe('payee_unverifiable')
  })

  it('a request with no stored payee can be paid, and records that nothing was compared', () => {
    const r = ok(evaluateDecision(base({ payeeHash: null }), [], DPR(), { action: 'MARK_PAID', proofRef: '0xabc123abc123' }, p, ENV))
    expect(r.checklist.payeeChecked).toBe('not_stored')
  })

  it('refuses while the restricted-list check could not run', () => {
    const s = base({ flags: [flag({ id: 'restricted_check_failed' })] })
    expect(code(evaluateDecision(s, [], DPR(), { ...pay, ackFlagIds: ['restricted_check_failed'], note: 'seen' }, p, ENV))).toBe('check_failed')
  })
})

describe('evaluateDecision: votes', () => {
  const big = snapshot({ amountUsdCents: 100_000, lane: 'VOTE_REQUIRED' })
  it('requires the proposal link, the confirmation and the aye count', () => {
    expect(code(evaluateDecision(big, [], actor(A), { action: 'APPROVE', note: 'poll checked' }, p))).toBe('proposal_missing')
    const withUrl = { ...big, proposalUrl: 'https://example.com/poll' }
    expect(code(evaluateDecision(withUrl, [], actor(A), { action: 'APPROVE', note: 'poll checked' }, p))).toBe('proposal_unconfirmed')
    expect(code(evaluateDecision(withUrl, [], actor(A), { action: 'APPROVE', note: 'poll checked', checklist: { proposalPassed: true }, ayesConfirmed: 24 }, p))).toBe('proposal_unconfirmed')
    expect(ok(evaluateDecision(withUrl, [], actor(A), { action: 'APPROVE', note: 'poll checked', checklist: { proposalPassed: true }, ayesConfirmed: 25 }, p)).nextStatus).toBe('APPROVED')
  })
  it('uses the higher aye tier above the second-tier limit', () => {
    const huge = { ...big, amountUsdCents: 300_000, proposalUrl: 'https://example.com/poll' }
    expect(code(evaluateDecision(huge, [], actor(A), { action: 'APPROVE', note: 'poll checked', checklist: { proposalPassed: true }, ayesConfirmed: 30 }, p))).toBe('proposal_unconfirmed')
  })
  it('a lowered cap applies at decision time, whatever lane was stored', () => {
    const stale = snapshot({ amountUsdCents: 40_000, lane: 'STANDARD' })
    expect(code(evaluateDecision(stale, [], actor(A), { action: 'APPROVE', note: 'poll checked' }, policy({ onApprovalCapUsd: 300 })))).toBe('proposal_missing')
  })
})

describe('evaluateDecision: paying', () => {
  const approved = snapshot({ status: 'APPROVED' })
  it('only the top role (or a pinned treasury role) can mark paid, with a reference', () => {
    expect(code(evaluateDecision(approved, [], actor(A), { action: 'MARK_PAID', proofRef: '0xabc123abc123' }, p))).toBe('forbidden')
    expect(code(evaluateDecision(approved, [], DPR(), { action: 'MARK_PAID' }, p))).toBe('proof_required')
    expect(code(evaluateDecision(approved, [], DPR(), { action: 'MARK_PAID', proofRef: '12345678901' }, p))).toBe('proof_required')
    expect(ok(evaluateDecision(approved, [], DPR(), { action: 'MARK_PAID', proofRef: '0xabc123abc123' }, p)).nextStatus).toBe('PAID')
    const treasurer = actor(B, { canMarkPaid: true })
    expect(ok(evaluateDecision(approved, [], treasurer, { action: 'MARK_PAID', proofRef: 'transfer-2026-001' }, p)).nextStatus).toBe('PAID')
  })
  it('cannot pay a request that is not approved, or your own', () => {
    expect(code(evaluateDecision(snapshot(), [], DPR(), { action: 'MARK_PAID', proofRef: '0xabc123abc123' }, p))).toBe('bad_state')
    expect(code(evaluateDecision(approved, [], DPR('100000000000000001'), { action: 'MARK_PAID', proofRef: '0xabc123abc123' }, p))).toBe('self_review')
  })
  it('proof references reject account-number shapes', () => {
    expect(validProofRef('0x9f2c1d7a')).toBe(true)
    expect(validProofRef('GB82WEST12345698765432')).toBe(false)
    expect(validProofRef('1234 5678 9012')).toBe(false)
    expect(validProofRef('abc')).toBe(false)
  })
})

describe('evaluateDecision: other actions', () => {
  it('reopen is top-role only and never for PAID', () => {
    expect(code(evaluateDecision(snapshot({ status: 'REJECTED' }), [], actor(A), { action: 'REOPEN', note: 'new info' }, p))).toBe('forbidden')
    expect(code(evaluateDecision(snapshot({ status: 'PAID' }), [], DPR(), { action: 'REOPEN', note: 'new info' }, p))).toBe('bad_state')
    expect(ok(evaluateDecision(snapshot({ status: 'REJECTED' }), [], DPR(), { action: 'REOPEN', note: 'new info' }, p)).nextStatus).toBe('RECEIVED')
  })
  it('reject needs a reason and records the fraud mark', () => {
    expect(code(evaluateDecision(snapshot(), [], actor(A), { action: 'REJECT' }, p))).toBe('note_required')
    const r = ok(evaluateDecision(snapshot(), [], actor(A), { action: 'REJECT', note: 'fake receipt', asFraud: true }, p))
    expect(r.rejectedAsFraud).toBe(true)
  })
  it('only the requester can withdraw or reply', () => {
    const me = '100000000000000001'
    expect(code(evaluateDecision(snapshot(), [], actor(A), { action: 'WITHDRAW' }, p))).toBe('not_requester')
    expect(ok(evaluateDecision(snapshot(), [], actor(me, { canReview: false }), { action: 'WITHDRAW' }, p)).nextStatus).toBe('WITHDRAWN')
    expect(ok(evaluateDecision(snapshot({ status: 'NEEDS_INFO' }), [], actor(me, { canReview: false }), { action: 'REPLY', note: 'here it is' }, p)).nextStatus).toBe('RECEIVED')
  })
})

describe('applyDecision (database)', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'req1', status: 'RECEIVED', lane: 'STANDARD', riskScore: 0, flags: [], approvalsNeeded: 1, requesterDiscordId: '100000000000000001', claimedDiscordId: null,
    checkedAt: new Date('2026-11-02T00:00:00Z'), payeeHash: null, attachments: [], checks: [{ result: { marker: { attachments: '0:', approvals: 0 } } }],
    proposalUrl: null, amountUsdCents: 20000, updatedAt: new Date('2026-11-01T00:00:00Z'), decisions: [], ...over,
  })
  let tx: Record<string, Record<string, ReturnType<typeof vi.fn>>>
  beforeEach(() => {
    tx = {
      paymentRequest: { findUnique: vi.fn().mockResolvedValue(row()), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      paymentDecision: { create: vi.fn().mockResolvedValue({}), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
      accountSignal: { findMany: vi.fn().mockResolvedValue([]) },
    }
    ;(prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx))
  })

  it('appends one decision row and never updates or deletes a decision', async () => {
    const r = await applyDecision('req1', actor(A), { action: 'APPROVE' }, p, { env: { VERCEL_ENV: 'preview' } as never })
    expect(r.ok).toBe(true)
    expect(tx.paymentDecision.create).toHaveBeenCalledTimes(1)
    const data = tx.paymentDecision.create.mock.calls[0][0].data
    expect(data).toMatchObject({ action: 'APPROVE', actorDiscordId: A, deployEnv: 'preview' })
    for (const m of ['update', 'updateMany', 'delete', 'deleteMany']) expect(tx.paymentDecision[m]).not.toHaveBeenCalled()
    expect(tx.paymentRequest.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'req1' })
    expect(tx.paymentRequest.updateMany.mock.calls[0][0].data.status).toBe('APPROVED')
  })

  it('a concurrent approval hits the updatedAt check and records nothing final', async () => {
    tx.paymentRequest.updateMany.mockResolvedValue({ count: 0 })
    const r = await applyDecision('req1', actor(A), { action: 'APPROVE' }, p)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.code).toBe('conflict')
  })

  it('a stale screen (expectedUpdatedAt differs) is refused before anything is written', async () => {
    const r = await applyDecision('req1', actor(A), { action: 'APPROVE' }, p, { expectedUpdatedAt: '2026-10-01T00:00:00.000Z' })
    expect(r.ok === false && r.code).toBe('conflict')
    expect(tx.paymentDecision.create).not.toHaveBeenCalled()
  })

  it('treats a linked account of the requester as the requester', async () => {
    tx.accountSignal.findMany.mockResolvedValue([{ discordIds: ['100000000000000001', A] }])
    const r = await applyDecision('req1', actor(A), { action: 'APPROVE' }, p)
    expect(r.ok === false && r.code).toBe('self_review')
    expect(tx.paymentDecision.create).not.toHaveBeenCalled()
  })

  it('whoever entered the dollar value cannot approve the request', async () => {
    tx.paymentRequest.findUnique.mockResolvedValue(row({ decisions: [{ id: 1, action: 'NOTE', actorDiscordId: A, actorIsDpr: false, createdAt: new Date('2026-11-01T01:00:00Z'), checklist: { usdAmountSet: 44.5 } }] }))
    const mine = await applyDecision('req1', actor(A), { action: 'APPROVE' }, p)
    expect(mine.ok === false && mine.code).toBe('self_review')
    expect(tx.paymentDecision.create).not.toHaveBeenCalled()
    const other = await applyDecision('req1', actor(B), { action: 'APPROVE' }, p)
    expect(other.ok).toBe(true)
  })

  it('404 for an unknown request', async () => {
    tx.paymentRequest.findUnique.mockResolvedValue(null)
    const r = await applyDecision('nope', actor(A), { action: 'APPROVE' }, p)
    expect(r.ok === false && r.status).toBe(404)
  })
})

describe('setUsdAmount', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'req1', status: 'RECEIVED', lane: 'STANDARD', riskScore: 0, flags: [], requesterDiscordId: null, claimedDiscordId: '100000000000000001',
    amountUsdCents: 0, currency: 'EUR', amountOriginal: 40, updatedAt: new Date('2026-11-01T00:00:00Z'), ...over,
  })
  let tx: Record<string, Record<string, ReturnType<typeof vi.fn>>>
  beforeEach(() => {
    tx = {
      paymentRequest: { findUnique: vi.fn().mockResolvedValue(row()), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      paymentDecision: { create: vi.fn().mockResolvedValue({}) },
      accountSignal: { findMany: vi.fn().mockResolvedValue([]) },
    }
    ;(prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx))
  })

  it('records the dollar value as an append-only note with the reason', async () => {
    const r = await setUsdAmount('req1', actor(A), { amountUsd: '44.50', note: 'rate on the day from a public rate table' })
    expect(r.ok).toBe(true)
    // The old check no longer describes this request: checks must run again before anyone can approve.
    expect(tx.paymentRequest.updateMany.mock.calls[0][0].data).toEqual({ amountUsdCents: 4450, checkedAt: null })
    expect(tx.paymentDecision.create.mock.calls[0][0].data).toMatchObject({ action: 'NOTE', checklist: { usdAmountSet: 44.5, originalCurrency: 'EUR', original: 40 } })
  })

  it('needs a reason and a real amount, a reviewer, and a request with no dollar value yet', async () => {
    expect((await setUsdAmount('req1', actor(A), { amountUsd: '10' })).ok).toBe(false)
    expect((await setUsdAmount('req1', actor(A), { amountUsd: 'x', note: 'because' })).ok).toBe(false)
    expect((await setUsdAmount('req1', actor(A, { canReview: false }), { amountUsd: '10', note: 'because' })).ok).toBe(false)
    tx.paymentRequest.findUnique.mockResolvedValue(row({ amountUsdCents: 5000 }))
    const r = await setUsdAmount('req1', actor(A), { amountUsd: '10', note: 'because' })
    expect(r.ok === false && r.code).toBe('has_amount')
  })

  it('cannot be used on your own request, including the id claimed on it', async () => {
    const r = await setUsdAmount('req1', actor('100000000000000001'), { amountUsd: '10', note: 'because' })
    expect(r.ok === false && r.code).toBe('self_review')
    expect(tx.paymentDecision.create).not.toHaveBeenCalled()
  })
})
