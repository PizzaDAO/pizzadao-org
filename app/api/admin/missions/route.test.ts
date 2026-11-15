// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/app/lib/mission-review-access', () => ({ isDreadPizzaRoberts: vi.fn() }))
vi.mock('@/app/lib/admin-missions', async (orig) => ({
  ...(await orig<typeof import('@/app/lib/admin-missions')>()),
  listAdminLevels: vi.fn(async () => []),
  updateMission: vi.fn(),
  updateLevel: vi.fn(),
  createAnytimeMission: vi.fn(),
}))
vi.mock('@/app/lib/settings/store', () => ({
  listChanges: vi.fn(async () => [
    { id: 1, key: 'mission:3:title' }, { id: 2, key: 'missionLevel:4:reward' }, { id: 3, key: 'missions.maxAttempts' }, { id: 4, key: 'missionary' },
  ]),
}))

import { getSession } from '@/app/lib/session'
import { isDreadPizzaRoberts } from '@/app/lib/mission-review-access'
import { createAnytimeMission, MissionEditError, updateLevel, updateMission } from '@/app/lib/admin-missions'
import { GET, PATCH, POST } from './route'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const req = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request('https://app.test/api/admin/missions', {
    method,
    headers: { 'content-type': 'application/json', host: 'app.test', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  m(getSession).mockResolvedValue({ discordId: '400000000000000001' })
  m(isDreadPizzaRoberts).mockResolvedValue(true)
  m(updateMission).mockResolvedValue({ changed: ['title'] })
  m(updateLevel).mockResolvedValue({ changed: ['reward'] })
})

describe('/api/admin/missions', () => {
  it('401 without a session, 403 for non-DPR, never calling the editor', async () => {
    m(getSession).mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
    expect((await PATCH(req('PATCH', { missionId: 1, title: 'x' }))).status).toBe(401)
    m(getSession).mockResolvedValue({ discordId: '5' })
    m(isDreadPizzaRoberts).mockResolvedValue(false)
    const r = await PATCH(req('PATCH', { missionId: 1, title: 'x' }))
    expect(r.status).toBe(403)
    expect(r.headers.get('cache-control')).toContain('no-store')
    expect((await GET()).status).toBe(403)
    expect(updateMission).not.toHaveBeenCalled()
    expect(updateLevel).not.toHaveBeenCalled()
  })

  it('history lists only the exact mission audit prefixes', async () => {
    const j = await (await GET()).json()
    expect(j.changes.map((c: { key: string }) => c.key)).toEqual(['mission:3:title', 'missionLevel:4:reward'])
  })

  it('rejects non-JSON and cross-origin writes', async () => {
    expect((await PATCH(req('PATCH', { missionId: 1 }, { 'content-type': 'text/plain' }))).status).toBe(415)
    expect((await PATCH(req('PATCH', { missionId: 1 }, { origin: 'https://evil.test' }))).status).toBe(403)
    expect(updateMission).not.toHaveBeenCalled()
  })

  it('routes a mission edit and a level edit to the right function with the actor', async () => {
    await PATCH(req('PATCH', { missionId: 3, title: 'T', verifierParams: { min: 2 }, confirm: true, note: 'n' }))
    expect(updateMission).toHaveBeenCalledWith(3, { title: 'T', description: undefined, isActive: undefined, verifierParams: { min: 2 } }, '400000000000000001', { confirm: true, note: 'n' })
    await PATCH(req('PATCH', { level: 4, reward: 99 }))
    expect(updateLevel).toHaveBeenCalledWith(4, { reward: 99, levelTitle: undefined }, '400000000000000001', { confirm: false, note: undefined })
  })

  it('maps editor errors: 400 validation, 409 with the confirmation text', async () => {
    m(updateMission).mockRejectedValueOnce(new MissionEditError(400, 'min must be a positive integer'))
    const bad = await PATCH(req('PATCH', { missionId: 3, verifierParams: { min: 0 } }))
    expect(bad.status).toBe(400)
    expect((await bad.json()).error).toMatch(/positive integer/)
    m(updateLevel).mockRejectedValueOnce(new MissionEditError(409, 'Confirmation required', 'Applies from now on.'))
    const ask = await PATCH(req('PATCH', { level: 4, reward: 99 }))
    expect(ask.status).toBe(409)
    expect((await ask.json()).needsConfirm).toBe('Applies from now on.')
  })

  it('needs a missionId or a level', async () => {
    expect((await PATCH(req('PATCH', { title: 'x' }))).status).toBe(400)
    expect((await PATCH(req('PATCH', { missionId: '3' }))).status).toBe(400)
  })
})

describe('POST /api/admin/missions (add an Anytime mission)', () => {
  it('401 / 403 for non-DPR, 415 / 403 for unsafe writes, never creating', async () => {
    m(getSession).mockResolvedValue(null)
    expect((await POST(req('POST', { title: 'x' }))).status).toBe(401)
    m(getSession).mockResolvedValue({ discordId: '5' })
    m(isDreadPizzaRoberts).mockResolvedValue(false)
    expect((await POST(req('POST', { title: 'x' }))).status).toBe(403)
    m(isDreadPizzaRoberts).mockResolvedValue(true)
    expect((await POST(req('POST', { title: 'x' }, { 'content-type': 'text/plain' }))).status).toBe(415)
    expect((await POST(req('POST', { title: 'x' }, { origin: 'https://evil.test' }))).status).toBe(403)
    expect(createAnytimeMission).not.toHaveBeenCalled()
  })

  it('creates with the actor and returns 201; editor errors map to their status', async () => {
    m(createAnytimeMission).mockResolvedValueOnce({ id: 31, index: 5 })
    const res = await POST(req('POST', { title: 'T', description: 'd', proofKind: 'URL', note: 'n' }))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ ok: true, id: 31, index: 5 })
    expect(createAnytimeMission).toHaveBeenCalledWith({ title: 'T', description: 'd', proofKind: 'URL' }, '400000000000000001', 'n')
    m(createAnytimeMission).mockRejectedValueOnce(new MissionEditError(400, 'title must be 1 to 120 characters'))
    expect((await POST(req('POST', { title: '' }))).status).toBe(400)
  })
})
