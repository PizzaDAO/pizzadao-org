// @vitest-environment node
// Route-level rules: 404 for everyone ineligible on every route, no-store on every
// response, nomination validation / limits / duplicate, DPR-only voting, admin-only redaction.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND') } }))
vi.mock('@/app/lib/db', () => ({
  prisma: { disavowIdentifier: { findFirst: vi.fn(), findMany: vi.fn(async () => []) }, disavowal: { findUnique: vi.fn(), count: vi.fn(async () => 0), findMany: vi.fn(async () => []) } },
}))
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/app/lib/missions', () => ({ getCurrentLevel: vi.fn() }))
vi.mock('@/app/lib/mission-review-access', () => ({ isDreadPizzaRoberts: vi.fn() }))
vi.mock('@/app/lib/member-utils', () => ({ findMemberByDiscordId: vi.fn(async () => null) }))
vi.mock('@/app/lib/auth-guards', () => ({ isAdminDiscordId: vi.fn(async () => false) }))
vi.mock('@/app/lib/rate-limit', () => ({
  enforceRateLimit: vi.fn(async () => null),
  checkKeyedRateLimit: vi.fn(async () => ({ success: true, limit: 60, remaining: 59, reset: Date.now() + 1000 })),
  rateLimitResponse: vi.fn(() => new Response(JSON.stringify({ error: 'slow' }), { status: 429 })),
}))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: vi.fn() }))
vi.mock('@/app/lib/disavow/messages', () => ({
  vouchWarningStrings: vi.fn(async () => ({ title: 't', body: 'b', confirm: 'c', cancel: 'x', view: 'v' })),
}))
vi.mock('@/app/lib/disavow/match', () => ({
  identifierOr: (ids: unknown[]) => ids,
  viewerIdentifiers: vi.fn(async (d: string) => [{ kind: 'DISCORD_ID', value: d }]),
  // expands whatever was typed to the member behind it
  resolveSubjectIdentifiers: vi.fn(async (ids: Array<{ kind: string; value: string }>) =>
    [...ids, { kind: 'MEMBER_ID', value: '7' }, { kind: 'DISCORD_ID', value: '999000999' }]),
  findActiveListingFor: vi.fn(async (id: string) => (id === '7' ? { id: 'entry1' } : null)),
}))
vi.mock('@/app/lib/disavow/detail', () => ({
  listDisavowals: vi.fn(async () => ({ tab: 'listed', page: 1, pageSize: 50, total: 0, items: [] })),
  getDisavowDetail: vi.fn(async () => ({ id: 'e1', status: 'LISTED' })),
}))
vi.mock('@/app/lib/disavow/store', () => ({
  nominate: vi.fn(), castVote: vi.fn(), withdrawSubmission: vi.fn(), listMySubmissions: vi.fn(async () => []), suspend: vi.fn(), unsuspend: vi.fn(),
  openRemoveRound: vi.fn(), redact: vi.fn(), addResponse: vi.fn(), runDisavowCron: vi.fn(),
}))

import { prisma } from '@/app/lib/db'
import { getSession } from '@/app/lib/session'
import { getCurrentLevel } from '@/app/lib/missions'
import { isDreadPizzaRoberts } from '@/app/lib/mission-review-access'
import { isAdminDiscordId } from '@/app/lib/auth-guards'
import { enforceRateLimit, checkKeyedRateLimit } from '@/app/lib/rate-limit'
import { after } from 'next/server'
import * as store from '@/app/lib/disavow/store'
import { GET as listGET, POST as nominatePOST } from './route'
import { GET as detailGET } from './[id]/route'
import { POST as votePOST } from './[id]/vote/route'
import { POST as withdrawPOST } from './submissions/[sid]/withdraw/route'
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
  ['POST submission withdraw', () => withdrawPOST(req({}), { params: Promise.resolve({ sid: 's1' }) })],
  ['POST suspend', () => suspendPOST(req({}), ctx)],
  ['POST unsuspend', () => unsuspendPOST(req({}), ctx)],
  ['POST rounds', () => roundsPOST(req({}), ctx)],
  ['POST redact', () => redactPOST(req({ confirm: true }), ctx)],
  ['POST me/response', () => responsePOST(req({ text: 'hi' }))],
  ['POST me/appeal', () => appealPOST(req({}))],
  ['GET check', () => checkGET(req(undefined, 'https://app.pizzadao.org/api/disavow/check?memberId=7'))],
]

function as(level: number, opts: { dpr?: boolean; subject?: boolean; admin?: boolean } = {}) {
  m(getSession).mockResolvedValue({ discordId: ME })
  m(getCurrentLevel).mockResolvedValue(level)
  m(isDreadPizzaRoberts).mockResolvedValue(!!opts.dpr)
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
  it('level 5 can nominate; every identifier expands server-side; a non-DPR gets no entry id back', async () => {
    as(5)
    m(store.nominate).mockResolvedValue({ ok: true, id: 'new1' })
    const r = await nominatePOST(req({ ...goodNomination, identifiers: [{ kind: 'WALLET', value: '0x' + 'a'.repeat(40) }] }))
    expect(r.status).toBe(201)
    expect(await r.json()).toEqual({ ok: true })
    const arg = m(store.nominate).mock.calls[0][0]
    expect(arg.nominatorDiscordId).toBe(ME)
    expect(arg.identifiers).toEqual(expect.arrayContaining([{ kind: 'MEMBER_ID', value: '7' }, { kind: 'DISCORD_ID', value: '999000999' }]))
  })
  it('a DPR gets the new id back', async () => {
    as(1, { dpr: true })
    m(store.nominate).mockResolvedValue({ ok: true, id: 'new1' })
    expect(await (await nominatePOST(req(goodNomination))).json()).toEqual({ ok: true, id: 'new1' })
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
  it('non-DPR: a duplicate of a hidden (NOMINATED/SUSPENDED) entry is indistinguishable from an accepted nomination', async () => {
    as(5)
    m(store.nominate).mockResolvedValueOnce({ ok: true, id: 'new1' })
    const normal = await nominatePOST(req(goodNomination))
    for (const existingStatus of ['NOMINATED', 'SUSPENDED']) {
      m(store.nominate).mockResolvedValueOnce({ ok: false, code: 'duplicate', existingId: 'old1', existingStatus })
      const dup = await nominatePOST(req(goodNomination))
      expect(dup.status).toBe(normal.status)
      expect(await dup.json()).toEqual(await normal.clone().json())
      expect(dup.headers.get('Cache-Control')).toBe(normal.headers.get('Cache-Control'))
    }
  })
  it('non-DPR: a duplicate of a LISTED entry points to it (409); DPR see any existing entry', async () => {
    as(5)
    m(store.nominate).mockResolvedValueOnce({ ok: false, code: 'duplicate', existingId: 'old1', existingStatus: 'LISTED' })
    const listed = await nominatePOST(req(goodNomination))
    expect(listed.status).toBe(409)
    expect((await listed.json()).existingId).toBe('old1')
    as(1, { dpr: true })
    m(store.nominate).mockResolvedValueOnce({ ok: false, code: 'duplicate', existingId: 'old2', existingStatus: 'NOMINATED' })
    const dpr = await nominatePOST(req(goodNomination))
    expect(dpr.status).toBe(409)
    expect((await dpr.json()).existingId).toBe('old2')
  })
  it('the cap gives 429', async () => {
    as(5)
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

describe('my nominations and withdrawing', () => {
  it('the mine tab returns only the caller\'s own submissions (no entry data)', async () => {
    as(5)
    m(store.listMySubmissions).mockResolvedValue([{ id: 's1', displayName: 'Randy', createdAt: new Date(), status: 'submitted' }])
    const r = await listGET(req(undefined, 'https://app.pizzadao.org/api/disavow?tab=mine'))
    expect(m(store.listMySubmissions).mock.calls[0][0]).toBe(ME)
    const body = await r.json()
    expect(body.tab).toBe('mine')
    expect(Object.keys(body.items[0]).sort()).toEqual(['createdAt', 'displayName', 'id', 'status'])
  })
  it('withdrawing: a non-eligible caller gets 404; the owner succeeds; someone else\'s submission is 404', async () => {
    const sctx = { params: Promise.resolve({ sid: 's1' }) }
    as(1)
    expect((await withdrawPOST(req({}), sctx)).status).toBe(404)
    as(5)
    m(store.withdrawSubmission).mockResolvedValueOnce('ok')
    expect((await withdrawPOST(req({}), sctx)).status).toBe(200)
    expect(m(store.withdrawSubmission).mock.calls[0].slice(0, 2)).toEqual(['s1', ME])
    m(store.withdrawSubmission).mockResolvedValueOnce('not_found')
    expect((await withdrawPOST(req({}), sctx)).status).toBe(404)
  })
  it('the nomination route defers the slow work with after()', async () => {
    as(5)
    m(store.nominate).mockResolvedValue({ ok: true, id: 'n1' })
    await nominatePOST(req(goodNomination))
    const arg = m(store.nominate).mock.calls[0][0]
    expect(typeof arg.defer).toBe('function')
    const work = vi.fn()
    arg.defer(work)
    expect(after).toHaveBeenCalledWith(work)
  })
  it('detail views are rate limited per user, after the access check', async () => {
    as(1)
    await detailGET(req(), ctx)
    expect(checkKeyedRateLimit).not.toHaveBeenCalled()
    as(5)
    m(checkKeyedRateLimit).mockResolvedValueOnce({ success: false, limit: 60, remaining: 0, reset: Date.now() + 1000 } as never)
    expect((await detailGET(req(), ctx)).status).toBe(429)
    expect(checkKeyedRateLimit).toHaveBeenCalledWith('disavow-detail', ME)
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
  it('an admin who is the subject of the entry is refused (403)', async () => {
    as(1, { admin: true })
    m(store.redact).mockResolvedValue('conflict')
    expect((await redactPOST(req({ confirm: true }), ctx)).status).toBe(403)
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
    expect(await (await checkGET(req(undefined, url))).json()).toMatchObject({ listed: true, id: 'entry1', strings: { title: 't' } })
    expect(await (await checkGET(req(undefined, 'https://x/api/disavow/check?memberId=8'))).json()).toEqual({ listed: false })
  })
})

describe('listed member surface', () => {
  const entries = (...ids: string[]) => {
    m(prisma.disavowIdentifier.findMany).mockResolvedValue(ids.map(disavowalId => ({ disavowalId })))
    m(prisma.disavowal.findMany).mockResolvedValue(ids.map(id => ({ id, rounds: [] })))
  }
  it('response and appeal only work for a member with a LISTED/SUSPENDED entry', async () => {
    as(1)
    entries()
    expect((await responsePOST(req({ text: 'hello' }))).status).toBe(404)
    expect((await appealPOST(req({}))).status).toBe(404)
  })
  it('a listed member can respond and appeal', async () => {
    as(1)
    entries('e1')
    m(store.addResponse).mockResolvedValue('ok')
    m(store.openRemoveRound).mockResolvedValue('ok')
    expect((await responsePOST(req({ text: 'That was a refund dispute.' }))).status).toBe(200)
    expect((await responsePOST(req({ text: 'x'.repeat(1501) }))).status).toBe(400)
    expect((await appealPOST(req({}))).status).toBe(201)
    expect(m(store.openRemoveRound).mock.calls[0][2]).toEqual({ appeal: true })
    m(store.openRemoveRound).mockResolvedValue('too_soon')
    expect((await appealPOST(req({}))).status).toBe(429)
  })
  it('with several entries the request must say which one', async () => {
    as(1)
    entries('e1', 'e2')
    m(store.addResponse).mockResolvedValue('ok')
    expect((await responsePOST(req({ text: 'hello' }))).status).toBe(400)
    expect((await responsePOST(req({ id: 'e2', text: 'hello' }))).status).toBe(200)
    expect(m(store.addResponse).mock.calls[0][0]).toBe('e2')
    expect((await responsePOST(req({ id: 'nope', text: 'hello' }))).status).toBe(400)
  })
})
