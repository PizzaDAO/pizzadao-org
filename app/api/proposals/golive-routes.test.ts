// @vitest-environment node
// Go-live fixes at the route level: beneficiary, per-proposer cap, pilot gating and test proposals, withdraw, admin cancel.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ME = '111111111111111111'
const BEN = '300000000000000001'
const m = vi.hoisted(() => ({
  session: { discordId: '111111111111111111' } as { discordId: string } | null,
  pilot: [] as string[],
  maxOpen: 3,
  dpr: true,
  member: { memberId: 'M-9' } as { memberId: string } | null,
  create: vi.fn(),
  count: vi.fn(),
  cancel: vi.fn(),
  search: vi.fn(),
}))

vi.mock('@/app/lib/db', () => ({ prisma: {} }))
vi.mock('next/server', async (importOriginal) => ({ ...(await importOriginal<typeof import('next/server')>()), after: vi.fn() }))
vi.mock('@/app/lib/proposals/constants', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/app/lib/proposals/constants')>()), proposalsEnabled: async () => true }))
vi.mock('@/app/lib/settings', () => ({
  getSetting: async (k: string) => (k === 'proposals.maxOpenPerProposer' ? m.maxOpen : []),
  loadSettings: async () => ({ get: (k: string) => (k === 'proposals.pilotDiscordIds' ? m.pilot : undefined) }),
}))
vi.mock('@/app/lib/auth-guards', () => ({
  requireSession: async () => (m.session ? { ok: true, session: m.session } : { ok: false, response: new Response('{}', { status: 401 }) }),
}))
vi.mock('@/app/lib/admin-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/admin-guard')>()),
  requireDpr: async () => (m.dpr && m.session ? { ok: true, session: m.session } : { ok: false, response: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }) }),
}))
vi.mock('@/app/lib/rate-limit', () => ({ enforceRateLimit: async () => null, checkKeyedRateLimit: async () => ({ success: true }) }))
vi.mock('@/app/lib/proposals/proposer', () => ({ canSubmitProposal: async () => true }))
vi.mock('@/app/lib/sheets/member-repository', () => ({ fetchMemberByDiscordId: async () => m.member }))
vi.mock('@/app/lib/proposals/lifecycle', () => ({ openAndAnnounce: vi.fn(), cancelAndAnnounce: m.cancel }))
vi.mock('@/app/lib/proposals/store', () => ({ createProposal: m.create, countActiveFor: m.count }))
vi.mock('@/app/lib/followups/admin', () => ({ searchMembers: m.search }))

import { POST as createPOST } from './route'
import { POST as withdrawPOST } from './[id]/withdraw/route'
import { GET as membersGET } from './members/route'
import { POST as adminCancelPOST } from '../admin/proposals/[id]/cancel/route'

const post = (body: unknown) => new Request('https://app.pizzadao.org/api/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const ctx = { params: Promise.resolve({ id: 'p1' }) }
const form = { kind: 'FUNDING', title: 'Pizza party', description: 'A party that brings new people.', amount: '900' }

beforeEach(() => {
  vi.clearAllMocks()
  m.session = { discordId: ME }
  m.pilot = []
  m.maxOpen = 3
  m.dpr = true
  m.member = { memberId: 'M-9' }
  m.create.mockResolvedValue({ id: 'new1' })
  m.count.mockResolvedValue(0)
  m.cancel.mockResolvedValue({ ok: true, wasOpen: true, discordChannelId: null, discordMessageId: null })
  m.search.mockResolvedValue([{ memberId: 'M-1', name: 'Test Member', discordId: BEN }])
})

describe('POST /api/proposals: beneficiary, cap and pilot', () => {
  it('stores a beneficiary who is a member; a stranger is refused; naming yourself is naming nobody', async () => {
    expect((await createPOST(post({ ...form, beneficiary: BEN }))).status).toBe(201)
    expect(m.create).toHaveBeenLastCalledWith(expect.objectContaining({ beneficiaryDiscordId: BEN, proposerDiscordId: ME, isTest: false }))
    m.member = null
    const r = await createPOST(post({ ...form, beneficiary: BEN }))
    expect(r.status).toBe(400)
    expect(await r.json()).toEqual({ error: 'bad_beneficiary' })
    m.member = { memberId: 'M-9' }
    await createPOST(post({ ...form, beneficiary: ME }))
    expect(m.create).toHaveBeenLastCalledWith(expect.objectContaining({ beneficiaryDiscordId: null }))
    expect((await createPOST(post({ ...form, beneficiary: 'not an id' }))).status).toBe(400)
  })

  it('caps waiting and open proposals per member by the setting', async () => {
    m.count.mockResolvedValue(3)
    const r = await createPOST(post(form))
    expect(r.status).toBe(409)
    expect(await r.json()).toEqual({ error: 'too_many_open' })
    m.maxOpen = 1
    m.count.mockResolvedValue(1)
    expect((await createPOST(post(form))).status).toBe(409)
    m.count.mockResolvedValue(0)
    expect((await createPOST(post(form))).status).toBe(201)
  })

  it('during a pilot only listed members can submit, and what they submit is a test proposal', async () => {
    m.pilot = [ME]
    expect((await createPOST(post(form))).status).toBe(201)
    expect(m.create).toHaveBeenLastCalledWith(expect.objectContaining({ isTest: true }))
    m.pilot = ['999999999999999999']
    expect((await createPOST(post(form))).status).toBe(404)
    expect((await membersGET(new Request('https://app.pizzadao.org/api/proposals/members?q=te'))).status).toBe(404)
  })
})

describe('POST /api/proposals/[id]/withdraw', () => {
  it('lets the signed-in proposer withdraw (as a non-admin) and maps refusals', async () => {
    expect((await withdrawPOST(post({ reason: 'typo' }), ctx)).status).toBe(200)
    expect(m.cancel).toHaveBeenCalledWith('p1', { discordId: ME, admin: false }, 'typo')
    for (const [code, status] of [['not_allowed', 403], ['not_cancellable', 409], ['not_found', 404]] as const) {
      m.cancel.mockResolvedValueOnce({ ok: false, code })
      expect((await withdrawPOST(post({}), ctx)).status).toBe(status)
    }
    m.session = null
    expect((await withdrawPOST(post({}), ctx)).status).toBe(401)
  })

  it('refuses a non-JSON request and anyone outside a running pilot', async () => {
    const form = new Request('https://app.pizzadao.org/x', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })
    expect((await withdrawPOST(form, ctx)).status).toBe(415)
    m.pilot = ['999999999999999999']
    expect((await withdrawPOST(post({}), ctx)).status).toBe(404)
  })
})

describe('POST /api/admin/proposals/[id]/cancel', () => {
  it('is for Dread Pizza Roberts only, and requires a reason', async () => {
    m.dpr = false
    expect((await adminCancelPOST(post({ reason: 'spam' }), ctx)).status).toBe(403)
    expect(m.cancel).not.toHaveBeenCalled()
    m.dpr = true
    expect((await adminCancelPOST(post({ reason: 'spam proposal' }), ctx)).status).toBe(200)
    expect(m.cancel).toHaveBeenCalledWith('p1', { discordId: ME, admin: true }, 'spam proposal')
    m.cancel.mockResolvedValueOnce({ ok: false, code: 'bad_reason' })
    expect((await adminCancelPOST(post({}), ctx)).status).toBe(400)
    m.cancel.mockResolvedValueOnce({ ok: false, code: 'not_cancellable' })
    expect((await adminCancelPOST(post({ reason: 'x y z' }), ctx)).status).toBe(409)
  })

  it('refuses a cross-origin or non-JSON write', async () => {
    const cross = new Request('https://app.pizzadao.org/x', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' })
    expect((await adminCancelPOST(cross, ctx)).status).toBe(403)
  })
})

describe('GET /api/proposals/members', () => {
  it('returns names and ids only, for a signed-in voter', async () => {
    const r = await membersGET(new Request('https://app.pizzadao.org/api/proposals/members?q=te'))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ members: [{ name: 'Test Member', discordId: BEN }] })
    m.session = null
    expect((await membersGET(new Request('https://app.pizzadao.org/api/proposals/members?q=te'))).status).toBe(401)
  })
})
