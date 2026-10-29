// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { computeRuleFlags, scoreFlags, type RuleContext } from './rules'
import { policy } from './test-utils'

const NOW = new Date('2026-11-10T12:00:00Z')
const ctx = (over: Partial<RuleContext> = {}, req: Partial<RuleContext['req']> = {}): RuleContext => ({
  now: NOW,
  policy: policy(),
  newAccountDays: 30,
  req: {
    source: 'APP',
    kind: 'EVENT_BUDGET',
    amountUsdCents: 20000,
    currency: 'USD',
    eventDate: null,
    createdAt: NOW,
    rsvEventSlug: null,
    title: 'Community meetup',
    proposalUrl: null,
    requesterDiscordId: '100000000000000001',
    requesterMemberId: 'M-1',
    ...req,
  },
  attachments: [],
  reusedAttachment: false,
  sharedPayee: false,
  sharedPayeeFormRow: false,
  repeatFormPayee: false,
  priorFraud: false,
  claimedFraudHint: false,
  restrictedMatches: [],
  restrictedCheckFailed: false,
  restrictedCheckOff: false,
  hashConfigured: true,
  rsvFlagged: false,
  newAccount: false,
  siblings: [],
  ...over,
})
const ids = (c: RuleContext) => computeRuleFlags(c).map((f) => f.id)
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

describe('rule flags', () => {
  it('a clean event budget has no flags', () => {
    expect(ids(ctx())).toEqual([])
  })

  it('hard blocks: reused attachment, shared payee, prior fraud, restricted list', () => {
    const flags = computeRuleFlags(ctx({ reusedAttachment: true, sharedPayee: true, priorFraud: true, restrictedMatches: ['abc'] }))
    expect(flags.map((f) => f.id)).toEqual(['reused_attachment', 'shared_payee', 'prior_fraud', 'restricted_list'])
    expect(flags.every((f) => f.hardBlock && f.severity === 'high')).toBe(true)
    expect(flags.find((f) => f.id === 'restricted_list')?.restricted).toBe(true)
    expect(flags.filter((f) => f.id !== 'restricted_list').every((f) => !f.restricted)).toBe(true)
  })

  it('a failed restricted-list lookup is a visible medium flag, not silence', () => {
    const f = computeRuleFlags(ctx({ restrictedCheckFailed: true }))
    expect(f.map((x) => [x.id, x.severity])).toEqual([['restricted_check_failed', 'medium']])
    // A real match wins over the failure flag.
    expect(ids(ctx({ restrictedCheckFailed: true, restrictedMatches: ['x'] }))).toEqual(['restricted_list'])
  })

  it('over the cap with no proposal is high; with one it is not', () => {
    expect(ids(ctx({}, { amountUsdCents: 70000 }))).toEqual(['over_cap_no_vote'])
    expect(ids(ctx({}, { amountUsdCents: 70000, proposalUrl: 'https://example.com/p' }))).toEqual([])
  })

  it('split requests: each under the cap but together over', () => {
    const siblings = [{ amountUsdCents: 40000, createdAt: daysAgo(10) }]
    expect(ids(ctx({ siblings }, { amountUsdCents: 30000 }))).toEqual(['split_request'])
    expect(ids(ctx({ siblings: [{ amountUsdCents: 40000, createdAt: daysAgo(40) }] }, { amountUsdCents: 30000 }))).toEqual([])
    expect(ids(ctx({ siblings: [{ amountUsdCents: 10000, createdAt: daysAgo(10) }] }, { amountUsdCents: 30000 }))).toEqual([])
  })

  it('duplicate: similar amount from the same requester within 14 days', () => {
    expect(ids(ctx({ siblings: [{ amountUsdCents: 20500, createdAt: daysAgo(5) }] }))).toEqual(['duplicate_request'])
    expect(ids(ctx({ siblings: [{ amountUsdCents: 20500, createdAt: daysAgo(20) }] }))).toEqual([])
    expect(ids(ctx({ siblings: [{ amountUsdCents: 9000, createdAt: daysAgo(5) }] }))).toEqual([])
  })

  it('requester and account signals', () => {
    expect(ids(ctx({}, { requesterDiscordId: null, requesterMemberId: null }))).toEqual(['unmatched_requester'])
    expect(ids(ctx({}, { requesterDiscordId: null }))).toEqual([])
    expect(ids(ctx({ newAccount: true }))).toEqual(['new_account'])
    expect(ids(ctx({ newAccount: null }))).toEqual([])
  })

  it('non-dollar amounts are flagged, not converted', () => {
    expect(ids(ctx({}, { currency: 'EUR' }))).toEqual(['currency_unverified'])
  })

  it('a form row is always unverified (the id on it is only a claim)', () => {
    const f = computeRuleFlags(ctx({}, { source: 'FORM', requesterDiscordId: '100000000000000001' }))
    expect(f.map((x) => [x.id, x.severity])).toEqual([['unverified_requester', 'medium']])
    expect(ids(ctx({}, { source: 'APP' }))).toEqual([])
  })

  it('a form row is unmatched whatever was typed; a verified requester is not', () => {
    expect(ids(ctx({}, { source: 'FORM', requesterDiscordId: null, requesterMemberId: null }))).toEqual(['unverified_requester', 'unmatched_requester'])
    expect(ids(ctx({}, { source: 'APP', requesterDiscordId: '100000000000000001', requesterMemberId: null }))).toEqual([])
  })

  it('a form row repeating its own earlier form rows\' payee is a medium hint, not a block', () => {
    const f = computeRuleFlags(ctx({ repeatFormPayee: true }))
    expect(f.map((x) => [x.id, x.severity, x.hardBlock ?? false])).toEqual([['repeat_form_payee', 'medium', false]])
    expect(ids(ctx({ sharedPayee: true, repeatFormPayee: true }))).toEqual(['shared_payee'])
  })

  it('the shared-payee text does not claim a "different requester" it cannot know', () => {
    const f = computeRuleFlags(ctx({ sharedPayee: true }))
    expect(f[0].detail).not.toMatch(/different requester/i)
  })

  it('a verified request whose payee also appears on a form row gets a hint, not a block', () => {
    const f = computeRuleFlags(ctx({ sharedPayeeFormRow: true }))
    expect(f.map((x) => [x.id, x.severity, x.hardBlock ?? false])).toEqual([['shared_payee_form_row', 'medium', false]])
    // A real shared payee wins; the hint is not added on top.
    expect(ids(ctx({ sharedPayee: true, sharedPayeeFormRow: true }))).toEqual(['shared_payee'])
  })

  it('a claimed id with a fraud history is a medium hint, not a block', () => {
    const f = computeRuleFlags(ctx({ claimedFraudHint: true }))
    expect(f.map((x) => [x.id, x.severity, x.hardBlock ?? false])).toEqual([['claimed_id_history', 'medium', false]])
  })

  it('says so (info, no score) when the restricted list or payee fingerprints are off', () => {
    const f = computeRuleFlags(ctx({ restrictedCheckOff: true, hashConfigured: false }))
    expect(f.map((x) => [x.id, x.severity])).toEqual([['restricted_check_off', 'info'], ['payee_check_off', 'info']])
    expect(scoreFlags(f)).toBe(0)
  })

  it('reimbursements: before the event, and receipts', () => {
    const event = new Date('2026-11-20T00:00:00Z')
    const r = ctx({}, { kind: 'REIMBURSEMENT', eventDate: event })
    expect(ids(r)).toEqual(['reimburse_before_event', 'no_receipts'])
    const withReceipt = ctx({ attachments: [{ kind: 'RECEIPT', createdAt: new Date('2026-11-21T00:00:00Z') }] }, { kind: 'REIMBURSEMENT', eventDate: event, createdAt: new Date('2026-11-22T00:00:00Z') })
    expect(ids(withReceipt)).toEqual([])
    const late = ctx({ attachments: [{ kind: 'RECEIPT', createdAt: new Date('2026-12-30T00:00:00Z') }] }, { kind: 'REIMBURSEMENT', eventDate: event, createdAt: new Date('2026-11-22T00:00:00Z') })
    expect(ids(late)).toEqual(['late_receipts'])
  })

  it('work payments need a receipt too; event budgets do not', () => {
    expect(ids(ctx({}, { kind: 'WORK' }))).toEqual(['no_receipts'])
    expect(ids(ctx({}, { kind: 'EVENT_BUDGET' }))).toEqual([])
  })

  it('party events get an info flag only (no score)', () => {
    const f = computeRuleFlags(ctx({}, { title: 'Global Pizza Party reimbursement', kind: 'EVENT_BUDGET' }))
    expect(f.map((x) => [x.id, x.severity])).toEqual([['gpp_event', 'info']])
    expect(scoreFlags(f)).toBe(0)
    expect(ids(ctx({}, { rsvEventSlug: 'some-slug' }))).toEqual(['gpp_event'])
  })
})

describe('scoreFlags', () => {
  const f = (severity: 'high' | 'medium' | 'low' | 'info') => ({ id: 'x', severity, detail: '', source: 'rules' as const })
  it('weights 50 / 20 / 5 / 0 and caps at 100', () => {
    expect(scoreFlags([f('high'), f('medium'), f('low'), f('info')])).toBe(75)
    expect(scoreFlags([f('high'), f('high'), f('high')])).toBe(100)
    expect(scoreFlags([])).toBe(0)
  })
})
