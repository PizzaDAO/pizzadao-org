// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const requireSession = vi.fn()
vi.mock('@/app/lib/auth-guards', () => ({ requireSession: () => requireSession() }))
// admin-guard imports the DPR check, which this suite does not need.
vi.mock('@/app/lib/mission-review-access', () => ({ isDreadPizzaRoberts: vi.fn() }))
const fetchMemberIdByDiscordId = vi.fn()
vi.mock('@/app/lib/sheets/member-repository', () => ({ fetchMemberIdByDiscordId: (...a: unknown[]) => fetchMemberIdByDiscordId(...a) }))
const lanesEnabled = vi.fn()
const pinLane = vi.fn()
const setStepDone = vi.fn()
vi.mock('@/app/lib/lanes', () => ({
  lanesEnabled: () => lanesEnabled(),
  pinLane: (...a: unknown[]) => pinLane(...a),
  setStepDone: (...a: unknown[]) => setStepDone(...a),
}))

import { __resetMemoryRateLimits } from '@/app/lib/rate-limit'
import { POST as pin } from './pin/route'
import { POST as progress } from './progress/route'

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://app.test/api/lanes/${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'app.test', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  __resetMemoryRateLimits()
  lanesEnabled.mockResolvedValue(true)
  fetchMemberIdByDiscordId.mockResolvedValue('m1')
  requireSession.mockResolvedValue({ ok: true, session: { discordId: 'd1' } })
  pinLane.mockResolvedValue(true)
  setStepDone.mockResolvedValue(['s1'])
})

describe.each([
  ['pin', pin, { slug: 'host' }],
  ['progress', progress, { slug: 'host', stepId: 's1', done: true }],
] as const)('/api/lanes/%s', (name, handler, body) => {
  it('404 while the setting is off, before anything else runs', async () => {
    lanesEnabled.mockResolvedValue(false)
    expect((await handler(post(name, body))).status).toBe(404)
    expect(requireSession).not.toHaveBeenCalled()
    expect(pinLane).not.toHaveBeenCalled()
    expect(setStepDone).not.toHaveBeenCalled()
  })
  it('429s a flood from one client before the session or member lookup runs', async () => {
    const send = () => handler(post(name, body, { 'x-forwarded-for': '203.0.113.9' }))
    let limited = 0
    for (let i = 0; i < 80; i++) if ((await send()).status === 429) limited++
    expect(limited).toBeGreaterThan(0)
    requireSession.mockClear()
    fetchMemberIdByDiscordId.mockClear()
    expect((await send()).status).toBe(429)
    expect(requireSession).not.toHaveBeenCalled()
    expect(fetchMemberIdByDiscordId).not.toHaveBeenCalled()
  })
  it('401 without a session', async () => {
    requireSession.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'no' }, { status: 401 }) })
    expect((await handler(post(name, body))).status).toBe(401)
    expect(pinLane).not.toHaveBeenCalled()
    expect(setStepDone).not.toHaveBeenCalled()
  })
  it('403 for a session without a member profile (or when the lookup fails), writing nothing', async () => {
    fetchMemberIdByDiscordId.mockResolvedValue(null)
    expect((await handler(post(name, body))).status).toBe(403)
    fetchMemberIdByDiscordId.mockRejectedValue(new Error('sheet down'))
    expect((await handler(post(name, body))).status).toBe(403)
    expect(fetchMemberIdByDiscordId).toHaveBeenCalledWith('d1')
    expect(pinLane).not.toHaveBeenCalled()
    expect(setStepDone).not.toHaveBeenCalled()
  })
  it('rejects non-JSON and cross-origin writes', async () => {
    expect((await handler(post(name, body, { 'content-type': 'text/plain' }))).status).toBe(415)
    expect((await handler(post(name, body, { origin: 'https://evil.test' }))).status).toBe(403)
  })
  it('400 for a missing or malformed body', async () => {
    expect((await handler(post(name, 'not json'))).status).toBe(400)
    expect((await handler(post(name, {}))).status).toBe(400)
  })
})

describe('/api/lanes/pin', () => {
  it('pins for the session member and records the source (default guide, unknown ignored)', async () => {
    const res = await pin(post('pin', { slug: 'host', source: 'card' }))
    expect(res.status).toBe(200)
    expect(pinLane).toHaveBeenCalledWith('d1', 'host', 'card')
    await pin(post('pin', { slug: 'host', source: 'signup' }))
    expect(pinLane).toHaveBeenLastCalledWith('d1', 'host', 'guide')
  })
  it('404 for an unknown or unpublished lane', async () => {
    pinLane.mockResolvedValue(false)
    expect((await pin(post('pin', { slug: 'nope' }))).status).toBe(404)
  })
})

describe('/api/lanes/progress', () => {
  it('ticks for the session member and returns the done ids', async () => {
    const res = await progress(post('progress', { slug: 'host', stepId: 's1', done: true }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, doneStepIds: ['s1'] })
    expect(setStepDone).toHaveBeenCalledWith('d1', 'host', 's1', true)
  })
  it('404 for an unpublished lane; 400 when done is not a boolean', async () => {
    setStepDone.mockResolvedValue(null)
    expect((await progress(post('progress', { slug: 'host', stepId: 's1', done: true }))).status).toBe(404)
    expect((await progress(post('progress', { slug: 'host', stepId: 's1', done: 'yes' }))).status).toBe(400)
  })
})
