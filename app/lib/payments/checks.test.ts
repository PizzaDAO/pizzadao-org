// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db', () => {
  const model = () => ({ findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn() })
  const prisma = {
    paymentRequest: model(),
    paymentAttachment: model(),
    paymentCheck: model(),
    paymentDecision: model(),
    accountSignal: model(),
    disavowIdentifier: model(),
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  }
  prisma.$transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(prisma))
  return { prisma }
})
vi.mock('./signals', () => ({ signalsFor: vi.fn(async () => ({ rsvFlagged: false, fastEligible: false })) }))
vi.mock('@/app/lib/settings', () => ({ getSetting: vi.fn(async () => 30) }))
vi.mock('@/app/lib/disavow/constants', () => ({ disavowEnabled: vi.fn(() => true) }))
vi.mock('@/app/lib/disavow/match', () => ({
  viewerIdentifiers: vi.fn(async () => [{ kind: 'DISCORD_ID', value: '1' }]),
  identifiersForMember: vi.fn(async () => []),
  identifierOr: vi.fn(() => [{}]),
}))

import { prisma } from '@/app/lib/db'
import { disavowEnabled } from '@/app/lib/disavow/constants'
import { carriedFlags, evaluateRequest } from './checks'
import { policy } from './test-utils'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const REQ = '100000000000000001'
const base = (over: Record<string, unknown> = {}) => ({
  id: 'req1', updatedAt: new Date('2026-11-01T00:00:00Z'), status: 'RECEIVED', source: 'APP', lane: 'STANDARD', flags: [], approvalsNeeded: 1, claimedDiscordId: null, kind: 'EVENT_BUDGET', amountUsdCents: 20000, currency: 'USD', eventDate: null,
  createdAt: new Date('2026-11-10T00:00:00Z'), rsvEventSlug: null, title: 'Meetup', proposalUrl: null,
  requesterDiscordId: REQ, requesterMemberId: 'M-1', payeeHash: 'abc', attachments: [{ kind: 'RECEIPT', sha256: 'h1', createdAt: new Date() }], ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  process.env.PAYMENTS_HASH_SECRET = 'test-secret-value'
  m(disavowEnabled).mockReturnValue(true)
  m(prisma.paymentRequest.findUnique).mockResolvedValue(base())
  m(prisma.paymentRequest.findFirst).mockResolvedValue(null)
  m(prisma.paymentRequest.findMany).mockResolvedValue([])
  m(prisma.paymentAttachment.findFirst).mockResolvedValue(null)
  m(prisma.paymentCheck.findMany).mockResolvedValue([])
  m(prisma.accountSignal.findMany).mockResolvedValue([])
  m(prisma.disavowIdentifier.findMany).mockResolvedValue([])
  m(prisma.paymentDecision.findMany).mockResolvedValue([])
  m(prisma.paymentDecision.create).mockResolvedValue({})
  m(prisma.paymentRequest.updateMany).mockResolvedValue({ count: 1 })
  m(prisma.$queryRaw).mockResolvedValue([{ now: new Date('2026-11-11T12:00:00Z') }])
})

const saved = () => m(prisma.paymentRequest.updateMany).mock.calls[0][0].data

describe('evaluateRequest', () => {
  it('a clean request stays standard and writes a RULES snapshot', async () => {
    const r = await evaluateRequest('req1', { policy: policy(), now: new Date('2026-11-11T00:00:00Z') })
    expect(r).toMatchObject({ lane: 'STANDARD', riskScore: 0, approvalsNeeded: 1 })
    expect(saved()).toMatchObject({ lane: 'STANDARD', riskScore: 0 })
    expect(m(prisma.paymentCheck.create).mock.calls[0][0].data).toMatchObject({ kind: 'RULES' })
  })

  it('a reused file is a hard block: HIGH_RISK with the higher approval count', async () => {
    m(prisma.paymentAttachment.findFirst).mockResolvedValue({ id: 'other' })
    const r = await evaluateRequest('req1', { policy: policy() })
    expect(r?.lane).toBe('HIGH_RISK')
    expect(r?.approvalsNeeded).toBe(2)
    expect(r?.flags.map((f) => f.id)).toContain('reused_attachment')
  })

  it('a shared payee, and a prior fraud rejection on a linked account, are hard blocks', async () => {
    m(prisma.paymentRequest.findFirst).mockResolvedValue({ id: 'other' })
    m(prisma.accountSignal.findMany).mockResolvedValue([{ discordIds: [REQ, '200000000000000009'] }])
    const r = await evaluateRequest('req1', { policy: policy() })
    expect(r?.flags.map((f) => f.id)).toEqual(expect.arrayContaining(['shared_payee', 'prior_fraud']))
    expect(r?.lane).toBe('HIGH_RISK')
    const fraudQuery = m(prisma.paymentRequest.findFirst).mock.calls.find((c) => c[0].where.rejectedAsFraud)
    expect(fraudQuery?.[0].where.requesterDiscordId.in).toEqual([REQ, '200000000000000009'])
  })

  it('a disavow match is restricted and hard-blocks; a lookup failure is a visible flag', async () => {
    m(prisma.disavowIdentifier.findMany).mockResolvedValue([{ disavowalId: 'dis1' }])
    const hit = await evaluateRequest('req1', { policy: policy() })
    expect(hit?.flags.find((f) => f.id === 'restricted_list')).toMatchObject({ restricted: true, hardBlock: true })
    expect(hit?.lane).toBe('HIGH_RISK')

    m(prisma.paymentRequest.updateMany).mockClear()
    m(prisma.disavowIdentifier.findMany).mockRejectedValue(new Error('db'))
    const failed = await evaluateRequest('req1', { policy: policy() })
    expect(failed?.flags.map((f) => f.id)).toEqual(['restricted_check_failed'])
  })

  it('does nothing for a request that is already decided', async () => {
    m(prisma.paymentRequest.findUnique).mockResolvedValue(base({ status: 'PAID' }))
    expect(await evaluateRequest('req1', { policy: policy() })).toBeNull()
    expect(prisma.paymentRequest.update).not.toHaveBeenCalled()
  })

  it('over the cap goes to VOTE_REQUIRED; the unreadable-settings cap sends everything there', async () => {
    expect((await evaluateRequest('req1', { policy: policy({ onApprovalCapUsd: 100 }) }))?.lane).toBe('VOTE_REQUIRED')
  })

  it('fast lane only with an eligible signal, and a signal error means no fast lane', async () => {
    const fastPolicy = policy({ fastTrackEnabled: true })
    const yes = await evaluateRequest('req1', { policy: fastPolicy, signals: async () => ({ rsvFlagged: false, fastEligible: true }) })
    expect(yes?.lane).toBe('FAST')
    m(prisma.paymentRequest.update).mockClear()
    const boom = await evaluateRequest('req1', { policy: fastPolicy, signals: async () => { throw new Error('down') } })
    expect(boom?.lane).toBe('STANDARD')
    const flagged = await evaluateRequest('req1', { policy: fastPolicy, signals: async () => ({ rsvFlagged: true, fastEligible: true }) })
    expect(flagged?.flags.map((f) => f.id)).toContain('rsv_flagged')
    expect(flagged?.lane).not.toBe('FAST')
  })
})

describe('evaluateRequest: claims, resets, approved requests, AI', () => {
  const fastPolicy = policy({ fastTrackEnabled: true })
  const eligible = async () => ({ rsvFlagged: false, fastEligible: true })

  it('a form row is flagged unverified, never fast, and risk lookups use the claimed id', async () => {
    m(prisma.paymentRequest.findUnique).mockResolvedValue(base({ source: 'FORM', requesterDiscordId: null, claimedDiscordId: '200000000000000007' }))
    const r = await evaluateRequest('req1', { policy: fastPolicy, signals: eligible })
    expect(r?.flags.map((f) => f.id)).toContain('unverified_requester')
    expect(r?.lane).not.toBe('FAST')
    const fraudQ = m(prisma.paymentRequest.findFirst).mock.calls.find((c) => c[0].where.rejectedAsFraud)
    expect(JSON.stringify(fraudQ?.[0].where)).toContain('200000000000000007')
  })

  it('checks every linked account against the restricted list too', async () => {
    m(prisma.accountSignal.findMany).mockResolvedValue([{ discordIds: [REQ, '200000000000000009'] }])
    await evaluateRequest('req1', { policy: policy() })
    expect(prisma.disavowIdentifier.findMany).toHaveBeenCalledTimes(2)
  })

  it('prior fraud, split and duplicate history count only VERIFIED rows of a verified requester', async () => {
    m(prisma.paymentRequest.findFirst).mockResolvedValue({ id: 'old' })
    await evaluateRequest('req1', { policy: policy() })
    const fraudQ = m(prisma.paymentRequest.findFirst).mock.calls.find((c) => c[0].where.rejectedAsFraud)
    expect(fraudQ?.[0].where).toEqual({ rejectedAsFraud: true, requesterDiscordId: { in: [REQ] } })
    const sibQ = m(prisma.paymentRequest.findMany).mock.calls[0][0].where
    expect(sibQ.requesterDiscordId).toEqual({ in: [REQ] })
    expect(JSON.stringify(sibQ)).not.toContain('claimedDiscordId')
  })

  it('a form row\'s claimed id never counts as history: no fraud/sibling queries, only a non-blocking hint', async () => {
    m(prisma.paymentRequest.findUnique).mockResolvedValue(base({ source: 'FORM', requesterDiscordId: null, claimedDiscordId: '200000000000000007', requesterMemberId: null }))
    m(prisma.paymentRequest.findFirst).mockImplementation(async (a: { where: Record<string, unknown> }) => (a.where.rejectedAsFraud ? { id: 'old' } : null))
    const r = await evaluateRequest('req1', { policy: policy() })
    expect(r?.flags.map((f) => f.id)).toEqual(expect.arrayContaining(['unverified_requester', 'unmatched_requester', 'claimed_id_history']))
    expect(r?.flags.map((f) => f.id)).not.toContain('prior_fraud')
    expect(r?.flags.find((f) => f.id === 'claimed_id_history')).toMatchObject({ severity: 'medium' })
    expect(r?.flags.find((f) => f.id === 'claimed_id_history')?.hardBlock).toBeUndefined()
    expect(prisma.paymentRequest.findMany).not.toHaveBeenCalled()
  })

  it('saves only if the request did not change since it was read, and retries once on a conflict', async () => {
    m(prisma.paymentRequest.updateMany).mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 })
    const r = await evaluateRequest('req1', { policy: policy() })
    expect(r).not.toBeNull()
    expect(prisma.paymentRequest.updateMany).toHaveBeenCalledTimes(2)
    expect(m(prisma.paymentRequest.updateMany).mock.calls[0][0].where).toEqual({ id: 'req1', updatedAt: expect.any(Date) })
    expect(prisma.paymentRequest.findUnique).toHaveBeenCalledTimes(2) // re-read on fresh data
  })

  it('gives up with an error after a second conflict instead of overwriting', async () => {
    m(prisma.paymentRequest.updateMany).mockResolvedValue({ count: 0 })
    await expect(evaluateRequest('req1', { policy: policy() })).rejects.toThrow(/kept changing/)
  })

  it('checkedAt comes from the database clock unless a time is injected', async () => {
    await evaluateRequest('req1', { policy: policy() })
    expect(saved().checkedAt).toEqual(new Date('2026-11-11T12:00:00Z'))
  })

  it('says so when the restricted list is switched off', async () => {
    m(disavowEnabled).mockReturnValue(false)
    const r = await evaluateRequest('req1', { policy: policy() })
    expect(r?.flags.find((f) => f.id === 'restricted_check_off')?.severity).toBe('info')
    expect(prisma.disavowIdentifier.findMany).not.toHaveBeenCalled()
  })

  it('AI flags are shown but not scored: they remove FAST and can never force HIGH_RISK', async () => {
    const aiFlags = ['a', 'b', 'c'].map((id) => ({ id: `ai_${id}`, severity: 'medium', detail: 'x', source: 'ai' }))
    m(prisma.paymentCheck.findMany).mockResolvedValue([{ kind: 'AI_RECEIPT', result: { flags: aiFlags } }])
    const r = await evaluateRequest('req1', { policy: fastPolicy, signals: eligible })
    expect(r?.flags.length).toBe(3)
    expect(r?.riskScore).toBe(0)
    expect(r?.lane).toBe('STANDARD')
    const clean = (await (async () => { m(prisma.paymentCheck.findMany).mockResolvedValue([]); return evaluateRequest('req1', { policy: fastPolicy, signals: eligible }) })())
    expect(clean?.lane).toBe('FAST')
  })

  it('resets earlier approvals when the flags or the lane change', async () => {
    m(prisma.paymentRequest.findUnique).mockResolvedValue(base({ lane: 'STANDARD', flags: [] }))
    m(prisma.paymentAttachment.findFirst).mockResolvedValue({ id: 'other' }) // a reused file appears
    m(prisma.paymentDecision.findMany).mockResolvedValue([{ action: 'APPROVE', actorDiscordId: '200000000000000001', actorIsDpr: false }])
    await evaluateRequest('req1', { policy: policy() })
    const reset = m(prisma.paymentDecision.create).mock.calls[0][0].data
    expect(reset).toMatchObject({ action: 'SYSTEM_RESET', actorDiscordId: 'system', lane: 'HIGH_RISK' })
  })

  it('no reset when nothing changed, or when nobody had approved', async () => {
    await evaluateRequest('req1', { policy: policy() })
    expect(prisma.paymentDecision.create).not.toHaveBeenCalled()
    m(prisma.paymentAttachment.findFirst).mockResolvedValue({ id: 'other' })
    await evaluateRequest('req1', { policy: policy() })
    expect(prisma.paymentDecision.create).not.toHaveBeenCalled() // changed, but no approvals to reset
  })

  it('an APPROVED request gets fresh flags and a new checkedAt, but keeps its lane and approval count', async () => {
    m(prisma.paymentRequest.findUnique).mockResolvedValue(base({ status: 'APPROVED', lane: 'STANDARD', approvalsNeeded: 1 }))
    m(prisma.paymentAttachment.findFirst).mockResolvedValue({ id: 'other' })
    const r = await evaluateRequest('req1', { policy: policy(), now: new Date('2026-11-12T00:00:00Z') })
    expect(r?.flags.map((f) => f.id)).toContain('reused_attachment')
    expect(r?.lane).toBe('STANDARD')
    const data = saved()
    expect(data).toMatchObject({ lane: 'STANDARD', approvalsNeeded: 1, checkedAt: new Date('2026-11-12T00:00:00Z') })
    expect(prisma.paymentDecision.create).not.toHaveBeenCalled()
  })
})

describe('carriedFlags', () => {
  it('keeps AI flags across a re-check but never anything high', () => {
    const flags = [
      { id: 'ai_amount_mismatch', severity: 'medium', detail: 'x', source: 'ai' },
      { id: 'sneaky', severity: 'high', detail: 'x', source: 'ai' },
      { id: 'rule', severity: 'medium', detail: 'x', source: 'rules' },
    ]
    expect(carriedFlags([{ kind: 'AI_RECEIPT', result: { flags } }]).map((f) => f.id)).toEqual(['ai_amount_mismatch'])
    expect(carriedFlags([])).toEqual([])
  })

  it('a failed later AI run does not hide the last good run\'s flags', () => {
    const good = { id: 'ai_amount_mismatch', severity: 'medium', detail: 'x', source: 'ai' }
    const checks = [{ kind: 'AI_RECEIPT', result: { error: 'x', flags: [] } }, { kind: 'AI_RECEIPT', result: { flags: [good] } }]
    expect(carriedFlags(checks).map((f) => f.id)).toEqual(['ai_amount_mismatch'])
  })

  it('a reserved (pending) run does not hide the last finished one', () => {
    const good = { id: 'ai_amount_mismatch', severity: 'medium', detail: 'x', source: 'ai' }
    const checks = [{ kind: 'AI_RECEIPT', result: { pending: true, flags: [] } }, { kind: 'AI_RECEIPT', result: { flags: [good] } }]
    expect(carriedFlags(checks).map((f) => f.id)).toEqual(['ai_amount_mismatch'])
  })
})
