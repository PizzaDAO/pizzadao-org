// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db', () => ({
  prisma: {
    paymentRequest: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null), count: vi.fn(async () => 0) },
    paymentAttachment: { findFirst: vi.fn(async () => null) },
    appSetting: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    $transaction: vi.fn(),
  },
}))
vi.mock('@/app/lib/auth-guards', () => ({
  requireSession: vi.fn(),
  hasAnyRoleSafe: vi.fn(),
}))
vi.mock('@/app/lib/mission-review-access', () => ({ isDreadPizzaRoberts: vi.fn() }))
vi.mock('@/app/lib/payments/ai-check', () => ({ runAiCheck: vi.fn(async () => ({ ok: false, code: 'disabled', message: 'AI checks are switched off' })) }))
vi.mock('@/app/lib/payments/policy', () => ({
  loadPaymentPolicy: vi.fn(async () => (await import('@/app/lib/payments/test-utils')).policy()),
}))

import { NextResponse } from 'next/server'
import { requireSession, hasAnyRoleSafe } from '@/app/lib/auth-guards'
import { isDreadPizzaRoberts } from '@/app/lib/mission-review-access'
import { GET as listGET } from './route'
import { GET as detailGET } from './[id]/route'
import { POST as decisionPOST } from './[id]/decision/route'
import { GET as attachmentGET } from './[id]/attachments/[aid]/route'
import { POST as uploadPOST } from './[id]/attachments/route'
import { GET as exportGET } from './export/route'
import { PUT as configPUT } from './config/route'
import { POST as recheckPOST } from './[id]/recheck/route'
import { POST as aiPOST } from './[id]/ai-check/route'
import { POST as usdPOST } from './[id]/usd-amount/route'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const ctx = { params: Promise.resolve({ id: 'req1', aid: 'att1' }) }
const jsonReq = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request('https://app.test/api/admin/payments/req1/decision', {
    method,
    headers: { 'content-type': 'application/json', host: 'app.test', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

function as(who: 'none' | 'member' | 'reviewer' | 'dpr') {
  if (who === 'none') {
    m(requireSession).mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) })
    return
  }
  m(requireSession).mockResolvedValue({ ok: true, session: { discordId: '300000000000000001' } })
  m(hasAnyRoleSafe).mockResolvedValue(who === 'reviewer')
  m(isDreadPizzaRoberts).mockResolvedValue(who === 'dpr')
}

beforeEach(() => vi.clearAllMocks())

const ALL = [
  () => listGET(new Request('https://app.test/api/admin/payments')),
  () => detailGET(new Request('https://app.test/x'), ctx),
  () => decisionPOST(jsonReq('POST', { action: 'APPROVE' }), ctx),
  () => attachmentGET(new Request('https://app.test/x'), ctx),
  () => uploadPOST(new Request('https://app.test/x', { method: 'POST' }), ctx),
  () => recheckPOST(jsonReq('POST', {}), ctx),
  () => aiPOST(jsonReq('POST', {}), ctx),
  () => usdPOST(jsonReq('POST', {}), ctx),
  () => exportGET(),
  () => configPUT(jsonReq('PUT', { formSheetId: '' })),
]

describe('payment admin routes: auth', () => {
  it('401 without a session on every route', async () => {
    as('none')
    for (const call of ALL) {
      const r = await call()
      expect(r.status).toBe(401)
    }
  })

  it('403 for a signed-in non-reviewer on every route, with no-store', async () => {
    as('member')
    for (const call of ALL) {
      const r = await call()
      expect(r.status).toBe(403)
      expect(r.headers.get('cache-control')).toContain('no-store')
    }
  })

  it('a plain reviewer cannot export or change the form config (top role only)', async () => {
    as('reviewer')
    expect((await exportGET()).status).toBe(403)
    expect((await configPUT(jsonReq('PUT', { formSheetId: '' }))).status).toBe(403)
  })

  it('a reviewer can list, and the top role can export', async () => {
    as('reviewer')
    expect((await listGET(new Request('https://app.test/api/admin/payments'))).status).toBe(200)
    as('dpr')
    expect((await exportGET()).status).toBe(200)
  })
})

describe('payment admin routes: writes', () => {
  it('rejects a cross-origin decision and a non-JSON body', async () => {
    as('reviewer')
    expect((await decisionPOST(jsonReq('POST', { action: 'APPROVE' }, { origin: 'https://evil.test' }), ctx)).status).toBe(403)
    const form = new Request('https://app.test/x', { method: 'POST', headers: { 'content-type': 'text/plain', host: 'app.test' }, body: '{}' })
    expect((await decisionPOST(form, ctx)).status).toBe(415)
  })

  it('rejects an unknown action before touching the database', async () => {
    as('reviewer')
    expect((await decisionPOST(jsonReq('POST', { action: 'DELETE_EVERYTHING' }), ctx)).status).toBe(400)
    expect((await decisionPOST(jsonReq('POST', { action: 'WITHDRAW' }), ctx)).status).toBe(400)
  })

  it('refuses uploads from another origin and while the setting is off', async () => {
    as('reviewer')
    const cross = new Request('https://app.test/x', { method: 'POST', headers: { origin: 'https://evil.test', host: 'app.test' } })
    expect((await uploadPOST(cross, ctx)).status).toBe(403)
    const off = new Request('https://app.test/x', { method: 'POST', headers: { host: 'app.test' } })
    const r = await uploadPOST(off, ctx)
    expect(r.status).toBe(403)
    expect((await r.json()).error).toMatch(/switched off/)
  })

  it('the AI check is reviewer-click only and answers 403 while switched off', async () => {
    as('reviewer')
    const r = await aiPOST(jsonReq('POST', {}), ctx)
    expect(r.status).toBe(403)
    expect((await r.json()).code).toBe('disabled')
    expect((await aiPOST(jsonReq('POST', {}, { origin: 'https://evil.test' }), ctx)).status).toBe(403)
  })

  it('the attachment route never leaks a missing file as anything but 404', async () => {
    as('reviewer')
    expect((await attachmentGET(new Request('https://app.test/x'), ctx)).status).toBe(404)
  })
})
