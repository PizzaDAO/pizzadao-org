// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))
const getSession = vi.fn()
vi.mock('@/app/lib/session', () => ({ getSession: () => getSession() }))
vi.mock('@/app/lib/settings', () => ({ loadSettings: vi.fn(async () => ({ readFailed: false, invalidKeys: [], isSet: () => true, get: () => 10 })) }))
const publicLiveView = vi.fn()
const memberLiveView = vi.fn()
vi.mock('@/app/lib/calls/live-view', () => ({ publicLiveView: (...a: unknown[]) => publicLiveView(...a), memberLiveView: (...a: unknown[]) => memberLiveView(...a) }))
const findLiveSessionById = vi.fn()
vi.mock('@/app/lib/calls/live-state', () => ({ findLiveSessionById: (...a: unknown[]) => findLiveSessionById(...a) }))
const liveAccess = vi.fn()
vi.mock('@/app/lib/calls/live-access', () => ({ liveAccess: (...a: unknown[]) => liveAccess(...a) }))
const runLiveAction = vi.fn()
vi.mock('@/app/lib/calls/live-qa', async (orig) => ({ ...(await orig<typeof import('@/app/lib/calls/live-qa')>()), runLiveAction: (...a: unknown[]) => runLiveAction(...a) }))

import { GET as getPublic } from './public/route'
import { GET as getMember } from './route'
import { POST as postAction } from './action/route'
import { LiveQaError } from '@/app/lib/calls/live-qa'

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://x/api/calls/live/action', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({ discordId: '111111111111111', nick: 'Ann' })
  publicLiveView.mockResolvedValue({ calls: [{ sessionId: 'evt-1', title: 'Call', crewLabel: 'Ops', startedAt: 'x', streamLink: null, presentCount: 3 }], pollSeconds: 10 })
  memberLiveView.mockResolvedValue({ calls: [] })
  findLiveSessionById.mockResolvedValue({ sessionId: 'evt-1' })
  liveAccess.mockResolvedValue({ actionItems: { visible: true, minLevel: 4 }, host: false })
  runLiveAction.mockResolvedValue({})
})

describe('GET /api/calls/live/public', () => {
  it('needs no session and is CDN cached for about 10 seconds', async () => {
    getSession.mockResolvedValue(null)
    const res = await getPublic()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('s-maxage=5')
    expect(res.headers.get('cache-control')).toContain('stale-while-revalidate=10')
    expect(res.headers.get('cache-control')).toContain('public')
    expect(getSession).not.toHaveBeenCalled()
  })
  it('says nothing is live (briefly cached) if the lookup fails', async () => {
    publicLiveView.mockRejectedValue(new Error('db'))
    const res = await getPublic()
    expect((await res.json()).calls).toEqual([])
  })
})

describe('GET /api/calls/live (members)', () => {
  it('needs a session and is never cached', async () => {
    getSession.mockResolvedValue(null)
    const denied = await getMember(new Request('http://x/api/calls/live') as never)
    expect(denied.status).toBe(401)
    expect(memberLiveView).not.toHaveBeenCalled()
    getSession.mockResolvedValue({ discordId: '111111111111111', nick: 'Ann' })
    const ok = await getMember(new Request('http://x/api/calls/live?after=evt-1~1700000000000~abc&after=bad&after=evt-2~5~z') as never)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('cache-control')).toBe('private, no-store')
    expect(memberLiveView.mock.calls[0][1]).toEqual({ discordId: '111111111111111' })
    expect([...(memberLiveView.mock.calls[0][2] as Map<string, string>)]).toEqual([['evt-1', '1700000000000~abc'], ['evt-2', '5~z']])
  })
  it('ignores a malformed cursor', async () => {
    await getMember(new Request('http://x/api/calls/live?after=abc') as never)
    expect((memberLiveView.mock.calls[0][2] as Map<string, string>).size).toBe(0)
  })
})

describe('POST /api/calls/live/action', () => {
  it('needs a signed-in member', async () => {
    getSession.mockResolvedValue(null)
    expect((await postAction(post({ sessionId: 'evt-1', op: 'vote', questionId: 'q' }))).status).toBe(401)
    expect(runLiveAction).not.toHaveBeenCalled()
  })
  it('rejects an unknown or malformed action', async () => {
    expect((await postAction(post({ op: 'nuke' }))).status).toBe(400)
    expect((await postAction(post({ sessionId: 'evt-1', op: 'pollVote', pollId: 'p', option: 9 }))).status).toBe(400)
    expect((await postAction(new Request('http://x/a', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' }))).status).toBe(400)
  })
  it('requires a JSON content type and a same-origin request', async () => {
    const plain = new Request('http://x/api/calls/live/action', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ sessionId: 'evt-1', op: 'vote', questionId: 'q' }) })
    expect((await postAction(plain)).status).toBe(415)
    const cross = post({ sessionId: 'evt-1', op: 'vote', questionId: 'q' }, { origin: 'https://evil.test', host: 'app.pizzadao.org' })
    expect((await postAction(cross)).status).toBe(403)
    expect(runLiveAction).not.toHaveBeenCalled()
  })
  it('checks the named call is live (by id) before running the action', async () => {
    await postAction(post({ sessionId: 'evt-9', op: 'ask', text: 'hello?' }))
    expect(findLiveSessionById.mock.calls[0][1]).toBe('evt-9')
  })
  it('works only while a call is live', async () => {
    findLiveSessionById.mockResolvedValue(null)
    expect((await postAction(post({ sessionId: 'evt-1', op: 'ask', text: 'hello?' }))).status).toBe(409)
  })
  it('passes the member, their host flag and the live session to the action', async () => {
    liveAccess.mockResolvedValue({ actionItems: { visible: true, minLevel: 4 }, host: true })
    expect((await postAction(post({ sessionId: 'evt-1', op: 'ask', text: 'hello?', anonymous: true }))).status).toBe(200)
    const ctx = runLiveAction.mock.calls[0][0] as { sessionId: string; actor: unknown }
    expect(ctx.sessionId).toBe('evt-1')
    expect(ctx.actor).toEqual({ discordId: '111111111111111', name: 'Ann', host: true })
  })
  it('maps action errors to their status', async () => {
    runLiveAction.mockRejectedValue(new LiveQaError(429, 'too-fast'))
    const res = await postAction(post({ sessionId: 'evt-1', op: 'ask', text: 'hello?' }))
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'too-fast' })
    runLiveAction.mockRejectedValue(new LiveQaError(403, 'forbidden'))
    expect((await postAction(post({ sessionId: 'evt-1', op: 'moderate', questionId: 'q', action: 'hide' }))).status).toBe(403)
  })
})
