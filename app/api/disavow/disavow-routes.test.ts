// @vitest-environment node
// Route-level rules: 404 for everyone ineligible on every route, no-store on every
// response, nomination validation / limits / duplicate, DPR-only voting, admin-only redaction.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND') } }))
vi.mock('@/app/lib/db', () => ({
  prisma: { disavowIdentifier: { findFirst: vi.fn() }, disavowal: { findUnique: vi.fn(), count: vi.fn(async () => 0), findMany: vi.fn(async () => []) } },
}))
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/app/lib/missions', () => ({ getCurrentLevel: vi.fn() }))
vi.mock('@/app/lib/mission-review-access', () => ({ DPR_ONLY_MIN_LEVEL: 8, canReviewMission: vi.fn() }))
vi.mock('@/app/lib/member-utils', () => ({ findMemberByDiscordId: vi.fn(async () => null) }))
vi.mock('@/app/lib/auth-guards', () => ({ isAdminDiscordId: vi.fn(async () => false) }))
vi.mock('@/app/lib/rate-limit', () => ({ enforceRateLimit: vi.fn(async () => null) }))
vi.mock('@/app/lib/disavow/match', () => ({
  identifiersForMember: vi.fn(async (id: string) => [{ kind: 'MEMBER_ID', value: id }, { kind: 'DISCORD_ID', value: '999000999' }]),
  findActiveListingFor: vi.fn(async (id: string) => (id === '7' ? { id: 'entry1' } : null)),
}))
vi.mock('@/app/lib/disavow/detail', () => ({
  listDisavowals: vi.fn(async () => ({ tab: 'listed', page: 1, pageSize: 50, total: 0, items: [] })),
  getDisavowDetail: vi.fn(async () => ({ id: 'e1', status: 'LISTED' })),
}))
vi.mock('@/app/lib/disavow/store', () => ({
  nominate: vi.fn(), castVote: vi.fn(), withdraw: vi.fn(), suspend: vi.fn(), unsuspend: vi.fn(),
  openRemoveRound: vi.fn(), redact: vi.fn(), addResponse: vi.fn(), runDisavowCron: vi.fn(),
}))

import { prisma } from '@/app/lib/db'
import { getSession } from '@/app/lib/session'
import { getCurrentLevel } from '@/app/lib/missions'
import { canReviewMission } from '@/app/lib/mission-review-access'
import { isAdminDiscordId } from '@/app/lib/auth-guards'
import { enforceRateLimit } from '@/app/lib/rate-limit'
import * as store from '@/app/lib/disavow/store'
import { GET as listGET, POST as nominatePOST } from './route'
import { GET as detailGET } from './[id]/route'
import { POST as votePOST } from './[id]/vote/route'
import { POST as withdrawPOST } from './[id]/withdraw/route'
import { POST as suspendPOST } from './[id]/suspend/route'
import { POST as unsuspendPOST } from './[id]/unsuspend/route'
import { POST as roundsPOST } from './[id]/rounds/route'
import { POST as redactPOST } from './[id]/redact/route'
import { POST as responsePOST } from './me/response/route'
import { POST as appealPOST } from './me/appeal/route'
import { GET as checkGET } from './check/route'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const ME = '400000000000000001'
const ctx = { params: Promise.resolve({ id: 'e1' }) }
const req = (body?: unknown, url = 'https://app.pizzadao.org/api/disavow') =>
  new Request(url, { method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

const goodNomination = {
  displayName: 'Rug Pull Randy', reason: 'SCAM', attest: true,
  statement: 'Took 2 ETH on 2026-09-01 for a print job and never delivered anything.',
  evidenceUrls: ['https://example.com/proof'], identifiers: [{ kind: 'X_HANDLE', value: '@randy' }],
}

const ALL: Array<[string, () => Promise<Response>]> = [
  ['GET list', () => listGET(req())],
  ['POST nominate', () => nominatePOST(req(goodNomination))],
  ['GET detail', () => detailGET(req(), ctx)],
  ['POST vote', () => votePOST(req({ roundId: 'r', choice: 'YES' }), ctx)],
  ['POST withdraw', () => withdrawPOST(req({}), ctx)],
  ['POST suspend', () => suspendPOST(req({}), ctx)],
  ['POST unsuspend', () => unsuspendPOST(req({}), ctx)],
  ['POST rounds', () => roundsPOST(req({}), ctx)],
  ['POST redact', () => redactPOST(req({ confirm: true }), ctx)],
  ['POST me/response', () => responsePOST(req({ text: 'hi' }))],
  ['POST me/appeal', () => appealPOST()],
  ['GET check', () => checkGET(req(undefined, 'https://app.pizzadao.org/api/disavow/check?memberId=7'))],
]

function as(level: number, opts: { dpr?: boolean; subject?: boolean; admin?: boolean } = {}) {
  m(getSession).mockResolvedValue({ discordId: ME })
  m(getCurrentLevel).mockResolvedValue(level)
  m(canReviewMission).mockResolvedValue(!!opts.dpr)
  m(prisma.disavowIdentifier.findFirst).mockResolvedValue(opts.subject ? { id: 1 } : null)
  m(isAdminDiscordId).mockResolvedValue(!!opts.admin)
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.DISAVOW_ENABLED = 'true'
  as(1)
  m(enforceRateLimit).mockResolvedValue(null)
})
afterEach(() => { delete process.env.DISAVOW_ENABLED })

describe('404 for everyone who may not use the list', () => {
  for (const [name, call] of ALL) {
    it(`${name}: level 1, level 4, listed level 8, logged out, flag off`, async () => {
      const seen: Response[] = []
      as(1); seen.push(await call())
      as(4); seen.push(await call())
      as(8, { subject: true, dpr: true }); seen.push(await call())
      m(getSession).mockResolvedValue(null); seen.push(await call())
      as(8, { dpr: true, admin: true }); delete process.env.DISAVOW_ENABLED; seen.push(await call())
      for (const r of seen) {
        expect(r.status).toBe(404)
        expect(r.headers.get('Cache-Control')).toBe('private, no-store')
        expect(await r.json()).toEqual({ error: 'Not found' })
      }
      expect(store.nominate).not.toHaveBeenCalled()
      expect(store.castVote).not.toHaveBeenCalled()
      expect(store.redact).not.toHaveBeenCalled()
    })
  }
  it('the 404 body and status are identical to a route that does not exist for the feature (no 401/403)', async () => {
    as(1)
    for (const [, call] of ALL) expect([401, 403]).not.toContain((await call()).status)
  })
})

describe('eligible responses are no-store', () => {
  it('list, detail and check carry private, no-store', async () => {
    as(5)
    for (const call of [() => listGET(req()), () => detailGET(req(), ctx), () => checkGET(req(undefined, 'https://x/api/disavow/check?memberId=7'))]) {
      const r = await call()
      expect(r.status).toBe(200)
      expect(r.headers.get('Cache-Control')).toBe('private, no-store')
    }
  })
})

describe('nominate', () => {
  it('level 5 can nominate; 201 with the new id; picked members expand server-side', async () => {
    as(5)
    m(store.nominate).mockResolvedValue({ ok: true, id: 'new1' })
    const r = await nominatePOST(req({ ...goodNomination, identifiers: [{ kind: 'MEMBER_ID', value: '7' }] }))
    expect(r.status).toBe(201)
    expect(await r.json()).toEqual({ id: 'new1' })
    const arg = m(store.nominate).mock.calls[0][0]
    expect(arg.nominatorDiscordId).toBe(ME)
    expect(arg.identifiers).toEqual(expect.arrayContaining([{ kind: 'MEMBER_ID', value: '7' }, { kind: 'DISCORD_ID', value: '999000999' }]))
  })
  it('rejects bad input with 400 before touching the store', async () => {
    as(5)
    for (const bad of [
      { ...goodNomination, evidenceUrls: ['http://insecure.example'] },
      { ...goodNomination, statement: 'short' },
      { ...goodNomination, statement: 'x'.repeat(1501) },
      { ...goodNomination, attest: false },
      { ...goodNomination, reason: 'RUDE' },
    ]) expect((await nominatePOST(req(bad))).status).toBe(400)
    expect(store.nominate).not.toHaveBeenCalled()
  })
  it('duplicate gives 409 with a link to the existing entry; limit gives 429', async () => {
    as(5)
    m(store.nominate).mockResolvedValueOnce({ ok: false, code: 'duplicate', existingId: 'old1' })
    const dup = await nominatePOST(req(goodNomination))
    expect(dup.status).toBe(409)
    expect((await dup.json()).existingId).toBe('old1')
    m(store.nominate).mockResolvedValueOnce({ ok: false, code: 'rate_limited' })
    expect((await nominatePOST(req(goodNomination))).status).toBe(429)
  })
  it('the IP rate limit applies only after the access check', async () => {
    as(1)
    await nominatePOST(req(goodNomination))
    expect(enforceRateLimit).not.toHaveBeenCalled()
    as(5)
    m(enforceRateLimit).mockResolvedValue(new Response('slow', { status: 429 }) as never)
    expect((await nominatePOST(req(goodNomination))).status).toBe(429)
    expect(store.nominate).not.toHaveBeenCalled()
  })
})

describe('voting and DPR actions', () => {
  it('a level 8 non-DPR member cannot vote, suspend, or open rounds (404)', async () => {
    as(8)
    for (const call of [
      () => votePOST(req({ roundId: 'r', choice: 'YES' }), ctx),
      () => suspendPOST(req({}), ctx), () => unsuspendPOST(req({}), ctx), () => roundsPOST(req({}), ctx),
    ]) expect((await call()).status).toBe(404)
    expect(store.castVote).not.toHaveBeenCalled()
  })
  it('DPR vote passes through; the nominator/subject conflict is 403', async () => {
    as(1, { dpr: true })
    m(store.castVote).mockResolvedValueOnce({ ok: true, outcome: 'pending' })
    const ok = await votePOST(req({ roundId: 'r1', choice: 'YES', comment: 'seen the logs' }), ctx)
    expect(ok.status).toBe(200)
    expect(m(store.castVote).mock.calls[0][0]).toMatchObject({ disavowalId: 'e1', voterDiscordId: ME, roundId: 'r1', choice: 'YES' })
    m(store.castVote).mockResolvedValueOnce({ ok: false, code: 'conflict' })
    expect((await votePOST(req({ roundId: 'r1', choice: 'YES' }), ctx)).status).toBe(403)
    m(store.castVote).mockResolvedValueOnce({ ok: false, code: 'closed' })
    expect((await votePOST(req({ roundId: 'r1', choice: 'YES' }), ctx)).status).toBe(409)
  })
  it('invalid vote bodies are 400', async () => {
    as(1, { dpr: true })
    expect((await votePOST(req({ roundId: 'r1', choice: 'MAYBE' }), ctx)).status).toBe(400)
    expect((await votePOST(req({ choice: 'YES' }), ctx)).status).toBe(400)
  })
})

describe('redact', () => {
  it('needs an admin: a DPR who is not an admin gets 404', async () => {
    as(8, { dpr: true })
    expect((await redactPOST(req({ confirm: true }), ctx)).status).toBe(404)
    expect(store.redact).not.toHaveBeenCalled()
  })
  it('an admin must confirm, then it redacts', async () => {
    as(1, { admin: true })
    expect((await redactPOST(req({}), ctx)).status).toBe(400)
    m(store.redact).mockResolvedValue('ok')
    expect((await redactPOST(req({ confirm: true }), ctx)).status).toBe(200)
    expect(m(store.redact).mock.calls[0].slice(0, 2)).toEqual(['e1', ME])
  })
})

describe('check', () => {
  it('never answers ineligible users, answers eligible ones', async () => {
    as(4)
    const url = 'https://app.pizzadao.org/api/disavow/check?memberId=7'
    expect((await checkGET(req(undefined, url))).status).toBe(404)
    as(5)
    expect(await (await checkGET(req(undefined, url))).json()).toEqual({ listed: true, id: 'entry1' })
    expect(await (await checkGET(req(undefined, 'https://x/api/disavow/check?memberId=8'))).json()).toEqual({ listed: false })
  })
})

describe('listed member surface', () => {
  it('response and appeal only work for a member with a LISTED entry', async () => {
    as(1)
    m(prisma.disavowIdentifier.findFirst).mockResolvedValue(null)
    expect((await responsePOST(req({ text: 'hello' }))).status).toBe(404)
    expect((await appealPOST()).status).toBe(404)
  })
  it('a listed member can respond and appeal (via the subject lookup)', async () => {
    as(1)
    m(getSession).mockResolvedValue({ discordId: ME })
    m(prisma.disavowIdentifier.findFirst).mockResolvedValue({ disavowalId: 'e1' })
    m(prisma.disavowal.findUnique).mockResolvedValue({ id: 'e1', rounds: [] })
    m(store.addResponse).mockResolvedValue('ok')
    m(store.openRemoveRound).mockResolvedValue('ok')
    expect((await responsePOST(req({ text: 'That was a refund dispute.' }))).status).toBe(200)
    expect((await responsePOST(req({ text: 'x'.repeat(1501) }))).status).toBe(400)
    expect((await appealPOST()).status).toBe(201)
    expect(m(store.openRemoveRound).mock.calls[0][2]).toEqual({ appeal: true })
    m(store.openRemoveRound).mockResolvedValue('too_soon')
    expect((await appealPOST()).status).toBe(429)
  })
})
