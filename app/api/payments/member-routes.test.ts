// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db', () => ({
  prisma: { paymentRequest: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null), findUnique: vi.fn(async () => null) }, $transaction: vi.fn() },
}))
vi.mock('@/app/lib/auth-guards', () => ({ requireSession: vi.fn() }))
vi.mock('@/app/lib/rate-limit', () => ({
  checkKeyedRateLimit: vi.fn(async () => ({ success: true, limit: 5, remaining: 4, reset: 0 })),
  rateLimitResponse: vi.fn(() => new Response('{}', { status: 429 })),
}))
vi.mock('@/app/lib/sheets/member-repository', () => ({ fetchMemberByDiscordId: vi.fn(async () => ({ memberId: 'M-9', name: 'Test Member' })) }))
vi.mock('@/app/lib/payments/store', () => ({ createPaymentRequest: vi.fn(async () => ({ id: 'new1' })) }))
vi.mock('@/app/lib/payments/policy', () => ({ loadPaymentPolicy: vi.fn() }))
vi.mock('@/app/lib/payments/decide', () => ({ applyDecision: vi.fn() }))
vi.mock('@/app/lib/payments/trust-load', () => ({ hostViewFor: vi.fn(async () => ({ state: 'building', paid: 1, needed: 2, missing: ['history'] })) }))

import { NextResponse } from 'next/server'
import { requireSession } from '@/app/lib/auth-guards'
import { prisma } from '@/app/lib/db'
import { applyDecision } from '@/app/lib/payments/decide'
import { loadPaymentPolicy } from '@/app/lib/payments/policy'
import { createPaymentRequest } from '@/app/lib/payments/store'
import { policy } from '@/app/lib/payments/test-utils'
import { fetchMemberByDiscordId } from '@/app/lib/sheets/member-repository'
import { GET, POST } from './route'
import { POST as actionPOST } from './[id]/action/route'
import { POST as uploadPOST } from './[id]/attachments/route'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const ME = '100000000000000001'
const ctx = { params: Promise.resolve({ id: 'req1' }) }
const req = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://app.test/api/payments', { method: 'POST', headers: { 'content-type': 'application/json', host: 'app.test', ...headers }, body: JSON.stringify(body) })
const valid = { kind: 'WORK', title: 'Flyer design', description: 'Designed flyers for the meetup.', amount: '120', payee: '0x1234567890abcdef1234567890abcdef12345678' }

beforeEach(() => {
  vi.clearAllMocks()
  m(requireSession).mockResolvedValue({ ok: true, session: { discordId: ME, username: 'tester' } })
  m(loadPaymentPolicy).mockResolvedValue(policy({ requestFormEnabled: true }))
})

describe('/api/payments', () => {
  it('401 without a session', async () => {
    m(requireSession).mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) })
    expect((await GET()).status).toBe(401)
    expect((await POST(req(valid))).status).toBe(401)
  })

  it('stays closed while the form setting is off, and creates nothing', async () => {
    m(loadPaymentPolicy).mockResolvedValue(policy({ requestFormEnabled: false }))
    expect((await POST(req(valid))).status).toBe(403)
    expect(createPaymentRequest).not.toHaveBeenCalled()
  })

  it('creates a request for the signed-in member only (identity comes from the session)', async () => {
    const r = await POST(req({ ...valid, requesterDiscordId: '999', requesterLabel: 'Someone Else' }))
    expect(r.status).toBe(201)
    const data = m(createPaymentRequest).mock.calls[0][0]
    expect(data).toMatchObject({ requesterDiscordId: ME, claimedDiscordId: null, requesterMemberId: 'M-9', requesterLabel: 'Test Member', source: 'APP', amountUsdCents: 12000 })
    expect(JSON.stringify(data)).not.toContain('0x1234567890abcdef1234567890abcdef12345678')
  })

  it('members only: a signed-in account that is not in the member list cannot file', async () => {
    m(fetchMemberByDiscordId).mockResolvedValueOnce(null)
    expect((await POST(req(valid))).status).toBe(403)
    expect(createPaymentRequest).not.toHaveBeenCalled()
  })

  it('refuses cross-origin writes, bad input and party-platform links', async () => {
    expect((await POST(req(valid, { origin: 'https://evil.test' }))).status).toBe(403)
    expect((await POST(req({ ...valid, amount: 'x' }))).status).toBe(400)
    const party = await POST(req({ ...valid, description: 'Event at https://rsv.pizza/e/abc please pay' }))
    expect(party.status).toBe(422)
    expect(createPaymentRequest).not.toHaveBeenCalled()
  })

  it('shows the fast-track progress card only while the fast lane is on, and only progress', async () => {
    const off = await (await GET()).json()
    expect(off.fastTrack).toBeNull()
    m(loadPaymentPolicy).mockResolvedValue(policy({ requestFormEnabled: true, fastTrackEnabled: true }))
    const on = await (await GET()).json()
    expect(on.fastTrack).toEqual({ state: 'building', paid: 1, needed: 2, missing: ['history'] })
  })

  it('lists only the requester\'s own requests without reviewer detail', async () => {
    m(prisma.paymentRequest.findMany).mockResolvedValue([
      { id: 'a', title: 'T', kind: 'WORK', status: 'NEEDS_INFO', amountUsdCents: 5000, createdAt: new Date('2026-11-01T00:00:00Z'), decisions: [{ note: 'Please add the receipt' }] },
    ])
    const r = await GET()
    const body = await r.json()
    expect(m(prisma.paymentRequest.findMany).mock.calls[0][0].where).toEqual({ requesterDiscordId: ME })
    expect(body.requests[0]).toEqual({ id: 'a', title: 'T', kind: 'WORK', status: 'NEEDS_INFO', amountUsd: 50, createdAt: '2026-11-01T00:00:00.000Z', question: 'Please add the receipt' })
    expect(JSON.stringify(body)).not.toMatch(/flags|riskScore|lane|payee/i)
  })
})

describe('/api/payments/[id]/action', () => {
  it('only WITHDRAW and REPLY are possible here; a request that is not yours is a 404', async () => {
    expect((await actionPOST(req({ action: 'APPROVE' }), ctx)).status).toBe(400)
    expect((await actionPOST(req({ action: 'MARK_PAID' }), ctx)).status).toBe(400)
    m(applyDecision).mockResolvedValue({ ok: false, status: 403, code: 'not_requester', message: 'Only the requester can do that' })
    expect((await actionPOST(req({ action: 'WITHDRAW' }), ctx)).status).toBe(404)
  })

  it('acts as a non-reviewer: the actor never carries review or pay rights', async () => {
    m(applyDecision).mockResolvedValue({ ok: true, nextStatus: 'WITHDRAWN', approvalsAfter: 0, rejectedAsFraud: false, checklist: {} })
    const r = await actionPOST(req({ action: 'WITHDRAW' }), ctx)
    expect(r.status).toBe(200)
    expect(m(applyDecision).mock.calls[0][1]).toEqual({ discordId: ME, isDpr: false, canReview: false, canMarkPaid: false })
  })
})

describe('/api/payments/[id]/attachments', () => {
  it('is closed while receipt upload is off, and 404 for someone else\'s request', async () => {
    const mk = () => new Request('https://app.test/x', { method: 'POST', headers: { host: 'app.test' } })
    expect((await uploadPOST(mk(), ctx)).status).toBe(403)
    m(loadPaymentPolicy).mockResolvedValue(policy({ receiptUploadEnabled: true }))
    expect((await uploadPOST(mk(), ctx)).status).toBe(404)
  })
})
