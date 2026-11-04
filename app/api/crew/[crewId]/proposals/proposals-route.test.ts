// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/auth-guards', () => ({ requireSession: vi.fn() }))
vi.mock('@/app/lib/crew-leads', () => ({ canManageCrew: vi.fn() }))
vi.mock('@/app/lib/sheets-import/source', () => ({ usesDb: vi.fn() }))
vi.mock('@/app/lib/calls/transcript-access', () => ({ canViewCallTranscript: vi.fn() }))
vi.mock('@/app/lib/call-tasks/apply', () => ({ applyProposal: vi.fn(), dismissProposal: vi.fn(), applyAll: vi.fn() }))
vi.mock('@/app/lib/admin-guard', async (orig) => ({ ...(await orig<typeof import('@/app/lib/admin-guard')>()), rejectUnsafeWrite: vi.fn(() => null) }))

import { NextResponse } from 'next/server'
import { prisma } from '@/app/lib/db'
import { requireSession } from '@/app/lib/auth-guards'
import { canManageCrew } from '@/app/lib/crew-leads'
import { usesDb } from '@/app/lib/sheets-import/source'
import { canViewCallTranscript } from '@/app/lib/calls/transcript-access'
import { applyAll, applyProposal } from '@/app/lib/call-tasks/apply'
import { GET } from './route'
import { POST as decide } from './[id]/route'
import { POST as applyAllPost } from './apply-all/route'

const crewParams = (crewId: string) => ({ params: Promise.resolve({ crewId }) })
const idParams = (crewId: string, id: string) => ({ params: Promise.resolve({ crewId, id }) })
const req = (url = 'http://x/api/crew/ops/proposals', body?: unknown) =>
  new Request(url, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireSession).mockResolvedValue({ ok: true, session: { discordId: 'lead1' } } as never)
  vi.mocked(canManageCrew).mockResolvedValue(true)
  vi.mocked(usesDb).mockResolvedValue(true)
  vi.mocked(canViewCallTranscript).mockResolvedValue(false)
  vi.mocked(prisma.crewTaskProposal.findMany).mockResolvedValue([
    { id: 'p1', recordingId: 'r1', crewId: 'ops', kind: 'DONE', taskId: 't1', baseUpdatedAt: new Date('2026-11-01'), changes: { stage: { from: 'doing', to: 'done' } }, edited: null, leadName: null, leadMemberId: null, candidates: null, reason: 'Finished', quote: 'a private sentence', startMs: 1000, confidence: 'high', status: 'PENDING', createdAt: new Date('2026-11-02'), decidedAt: null },
  ] as never)
  vi.mocked(prisma.crewTask.findMany).mockResolvedValue([{ id: 't1', label: 'Order stickers', updatedAt: new Date('2026-11-01'), archived: false }] as never)
})

describe('GET /api/crew/[crewId]/proposals', () => {
  it('401s without a session and 403s for anyone who cannot manage the crew', async () => {
    vi.mocked(requireSession).mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'no' }, { status: 401 }) } as never)
    expect((await GET(req(), crewParams('ops'))).status).toBe(401)
    vi.mocked(requireSession).mockResolvedValue({ ok: true, session: { discordId: 'x' } } as never)
    vi.mocked(canManageCrew).mockResolvedValue(false)
    const res = await GET(req(), crewParams('ops'))
    expect(res.status).toBe(403)
    expect(prisma.crewTaskProposal.findMany).not.toHaveBeenCalled()
  })
  it('returns the reason but not the transcript quote to a lead who cannot read transcripts', async () => {
    const body = await (await GET(req(), crewParams('ops'))).json()
    expect(body.proposals[0]).toMatchObject({ id: 'p1', taskLabel: 'Order stickers', reason: 'Finished', quote: null, startMs: null, taskChanged: false })
    vi.mocked(canViewCallTranscript).mockResolvedValue(true)
    const withQuote = await (await GET(req(), crewParams('ops'))).json()
    expect(withQuote.proposals[0].quote).toBe('a private sentence')
  })
  it('crews still on the sheet have nothing to review', async () => {
    vi.mocked(usesDb).mockResolvedValue(false)
    expect(await (await GET(req(), crewParams('ops'))).json()).toEqual({ proposals: [], editable: false })
  })
})

describe('POST decisions', () => {
  it('refuses a proposal that belongs to another crew', async () => {
    vi.mocked(prisma.crewTaskProposal.findUnique).mockResolvedValue({ crewId: 'tech' } as never)
    const res = await decide(req('http://x', { action: 'apply' }), idParams('ops', 'p1'))
    expect(res.status).toBe(404)
    expect(applyProposal).not.toHaveBeenCalled()
  })
  it('maps a conflict to 409 with the current task, and passes force through', async () => {
    vi.mocked(prisma.crewTaskProposal.findUnique).mockResolvedValue({ crewId: 'ops' } as never)
    vi.mocked(applyProposal).mockResolvedValue({ result: 'conflict', current: { label: 'L', stage: 'now', priority: null, due: null, leadName: null } })
    const res = await decide(req('http://x', { action: 'apply', edits: { stage: 'now' } }), idParams('ops', 'p1'))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'conflict', current: { stage: 'now' } })
    await decide(req('http://x', { action: 'apply', force: true }), idParams('ops', 'p1'))
    expect(vi.mocked(applyProposal).mock.calls[1]).toEqual(['p1', 'lead1', { edits: undefined, force: true, confirmed: false }])
  })
  it('maps needs-confirm and passes the confirmation through', async () => {
    vi.mocked(prisma.crewTaskProposal.findUnique).mockResolvedValue({ crewId: 'ops' } as never)
    vi.mocked(applyProposal).mockResolvedValue({ result: 'needs-confirm' })
    const res = await decide(req('http://x', { action: 'apply' }), idParams('ops', 'p1'))
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('needs-confirm')
    await decide(req('http://x', { action: 'apply', confirmed: true }), idParams('ops', 'p1'))
    expect(vi.mocked(applyProposal).mock.calls[1][2]).toMatchObject({ confirmed: true })
  })
  it('rejects unknown actions', async () => {
    expect((await decide(req('http://x', { action: 'delete' }), idParams('ops', 'p1'))).status).toBe(400)
  })
  it('apply-all fails closed', async () => {
    vi.mocked(applyAll).mockResolvedValue('forbidden')
    expect((await applyAllPost(req('http://x', {}), crewParams('ops'))).status).toBe(403)
    vi.mocked(applyAll).mockResolvedValue({ applied: 2, skipped: [] })
    expect(await (await applyAllPost(req('http://x', { recordingId: 'r1' }), crewParams('ops'))).json()).toEqual({ ok: true, applied: 2, skipped: [] })
    expect(vi.mocked(applyAll).mock.calls[1]).toEqual(['ops', 'lead1', { recordingId: 'r1' }])
  })
})
