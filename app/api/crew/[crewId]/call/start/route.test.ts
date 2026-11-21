// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/app/lib/admin-guard', () => ({ rejectUnsafeWrite: vi.fn(() => null) }))
vi.mock('@/app/lib/rate-limit', async (orig) => ({ ...(await orig<typeof import('@/app/lib/rate-limit')>()), checkKeyedRateLimit: vi.fn() }))
vi.mock('@/app/lib/member-utils', () => ({ findMemberIdByDiscordId: vi.fn(async () => '7') }))
vi.mock('@/app/lib/crew-call-start-live', () => ({
  loadCrewCallContext: vi.fn(),
  mayStartCrewCall: vi.fn(),
  readCrewCallState: vi.fn(),
  buildStartDeps: vi.fn(),
  crewCallLinks: vi.fn(() => ({ voiceUrl: 'https://discord.com/channels/1/2', liveUrl: 'https://example.test/calls/live' })),
  crewRoleId: vi.fn(() => null),
}))
vi.mock('@/app/lib/crew-call-start', async (orig) => ({ ...(await orig<typeof import('@/app/lib/crew-call-start')>()), runCrewCallStart: vi.fn() }))

import { NextRequest } from 'next/server'
import { getSession } from '@/app/lib/session'
import { checkKeyedRateLimit } from '@/app/lib/rate-limit'
import { loadCrewCallContext, mayStartCrewCall, readCrewCallState, buildStartDeps } from '@/app/lib/crew-call-start-live'
import { runCrewCallStart } from '@/app/lib/crew-call-start'
import { GET, POST } from './route'

const params = { params: Promise.resolve({ crewId: 'ops' }) }
const post = () => new NextRequest('http://x/api/crew/ops/call/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
const get = () => new NextRequest('http://x/api/crew/ops/call/start')
const settings = { allowAdHoc: false, startWindowMinutes: 30, cooldownMinutes: 30, pingRole: false, postTemplate: '' }
const ctx = { enabled: true, allowCrewMembers: false, crewAllowed: true, settings, crew: { id: 'ops', label: 'Ops', callLength: '60' } }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue({ discordId: 'u1' } as never)
  vi.mocked(loadCrewCallContext).mockResolvedValue(ctx as never)
  vi.mocked(mayStartCrewCall).mockResolvedValue(true)
  vi.mocked(checkKeyedRateLimit).mockResolvedValue({ success: true, limit: 3, remaining: 2, reset: Date.now() + 1000 })
  vi.mocked(readCrewCallState).mockResolvedValue({ decision: { kind: 'start_event', occurrenceKey: 'k', eventId: 'e', channelId: 'c' }, event: null, voiceChannelId: 'c', nowMs: 0 })
  vi.mocked(buildStartDeps).mockReturnValue({} as never)
  vi.mocked(runCrewCallStart).mockResolvedValue({ status: 'started', occurrenceKey: 'k', eventId: 'e', adHoc: false, posted: true })
})

describe('POST /api/crew/[crewId]/call/start', () => {
  it('starts for someone allowed', async () => {
    const res = await POST(post(), params)
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('started')
    expect(mayStartCrewCall).toHaveBeenCalledWith('u1', 'ops', false)
  })
  it('401 without a session', async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    expect((await POST(post(), params)).status).toBe(401)
    expect(runCrewCallStart).not.toHaveBeenCalled()
  })
  it('403 for a plain member (no permission) and does nothing', async () => {
    vi.mocked(mayStartCrewCall).mockResolvedValue(false)
    expect((await POST(post(), params)).status).toBe(403)
    expect(readCrewCallState).not.toHaveBeenCalled()
    expect(runCrewCallStart).not.toHaveBeenCalled()
  })
  it('passes the crew-member setting to the permission check', async () => {
    vi.mocked(loadCrewCallContext).mockResolvedValue({ ...ctx, allowCrewMembers: true } as never)
    await POST(post(), params)
    expect(mayStartCrewCall).toHaveBeenCalledWith('u1', 'ops', true)
  })
  it('404 while the switch is off, or the crew is outside the pilot list', async () => {
    vi.mocked(loadCrewCallContext).mockResolvedValue({ ...ctx, enabled: false } as never)
    expect((await POST(post(), params)).status).toBe(404)
    vi.mocked(loadCrewCallContext).mockResolvedValue({ ...ctx, crewAllowed: false } as never)
    expect((await POST(post(), params)).status).toBe(404)
    expect(runCrewCallStart).not.toHaveBeenCalled()
  })
  it('429 when rate limited, before reading Discord', async () => {
    vi.mocked(checkKeyedRateLimit).mockResolvedValue({ success: false, limit: 3, remaining: 0, reset: Date.now() + 5000 })
    expect((await POST(post(), params)).status).toBe(429)
    expect(readCrewCallState).not.toHaveBeenCalled()
  })
  it('409 for refusals (already live, busy channel, double start)', async () => {
    for (const status of ['already_live', 'channel_busy', 'already_started'] as const) {
      vi.mocked(runCrewCallStart).mockResolvedValue({ status } as never)
      expect((await POST(post(), params)).status).toBe(409)
    }
  })
  it('200 preview answer on a preview deploy, 502 on a Discord failure', async () => {
    vi.mocked(runCrewCallStart).mockResolvedValue({ status: 'preview', wouldDo: 'start_event' })
    expect((await POST(post(), params)).status).toBe(200)
    vi.mocked(runCrewCallStart).mockResolvedValue({ status: 'discord_failed', code: 'discord_error' })
    expect((await POST(post(), params)).status).toBe(502)
  })
})

describe('GET /api/crew/[crewId]/call/start', () => {
  it('says canStart:false without reading Discord for people who may not press it', async () => {
    vi.mocked(mayStartCrewCall).mockResolvedValue(false)
    expect(await (await GET(get(), params)).json()).toEqual({ canStart: false })
    expect(readCrewCallState).not.toHaveBeenCalled()
  })
  it('canStart:false when the switch is off or signed out', async () => {
    vi.mocked(loadCrewCallContext).mockResolvedValue({ ...ctx, enabled: false } as never)
    expect(await (await GET(get(), params)).json()).toEqual({ canStart: false })
    vi.mocked(getSession).mockResolvedValue(null)
    expect(await (await GET(get(), params)).json()).toEqual({ canStart: false })
  })
  it('reports the state to show', async () => {
    const body = await (await GET(get(), params)).json()
    expect(body).toMatchObject({ canStart: true, state: 'idle' })
  })
})
