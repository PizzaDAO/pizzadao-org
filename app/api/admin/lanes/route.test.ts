// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/app/lib/mission-review-access', () => ({ isDreadPizzaRoberts: vi.fn() }))
vi.mock('@/app/lib/lanes/admin', async (orig) => ({
  ...(await orig<typeof import('@/app/lib/lanes/admin')>()),
  listAdminLanes: vi.fn(async () => ({ lanes: [], missions: [] })),
  updateLane: vi.fn(),
  createStep: vi.fn(),
  updateStep: vi.fn(),
  moveStep: vi.fn(),
  deleteStep: vi.fn(),
}))
const invalidateLaneLinks = vi.fn()
vi.mock('@/app/lib/lanes', () => ({ invalidateLaneLinks: () => invalidateLaneLinks() }))
vi.mock('@/app/lib/settings/store', () => ({
  listChanges: vi.fn(async () => [{ id: 1, key: 'lane:host:title' }, { id: 2, key: 'laneStep:x:body' }, { id: 3, key: 'mission:3:title' }, { id: 4, key: 'landing' }]),
}))

import { getSession } from '@/app/lib/session'
import { isDreadPizzaRoberts } from '@/app/lib/mission-review-access'
import { createStep, deleteStep, LaneEditError, moveStep, updateLane, updateStep } from '@/app/lib/lanes/admin'
import { DELETE, GET, PATCH, POST } from './route'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const ADMIN = '400000000000000001'
const req = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request('https://app.test/api/admin/lanes', {
    method,
    headers: { 'content-type': 'application/json', host: 'app.test', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  m(getSession).mockResolvedValue({ discordId: ADMIN })
  m(isDreadPizzaRoberts).mockResolvedValue(true)
  m(updateLane).mockResolvedValue({ changed: ['title'] })
  m(updateStep).mockResolvedValue({ changed: ['body'] })
  m(createStep).mockResolvedValue({ id: 'new1' })
})

describe('/api/admin/lanes', () => {
  it('401 without a session, 403 for non-DPR, never calling the editor', async () => {
    m(getSession).mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
    expect((await PATCH(req('PATCH', { slug: 'host', title: 'x' }))).status).toBe(401)
    m(getSession).mockResolvedValue({ discordId: '5' })
    m(isDreadPizzaRoberts).mockResolvedValue(false)
    expect((await PATCH(req('PATCH', { slug: 'host', title: 'x' }))).status).toBe(403)
    expect((await POST(req('POST', { slug: 'host', title: 'x' }))).status).toBe(403)
    expect((await DELETE(req('DELETE', { stepId: 's' }))).status).toBe(403)
    expect((await GET()).status).toBe(403)
    for (const f of [updateLane, updateStep, createStep, moveStep, deleteStep]) expect(f).not.toHaveBeenCalled()
  })

  it('history lists only lane audit keys', async () => {
    const j = await (await GET()).json()
    expect(j.changes.map((c: { key: string }) => c.key)).toEqual(['lane:host:title', 'laneStep:x:body'])
  })

  it('rejects non-JSON and cross-origin writes', async () => {
    expect((await PATCH(req('PATCH', { slug: 'host' }, { 'content-type': 'text/plain' }))).status).toBe(415)
    expect((await POST(req('POST', { slug: 'host' }, { origin: 'https://evil.test' }))).status).toBe(403)
    expect(updateLane).not.toHaveBeenCalled()
  })

  it('routes lane edits, step edits, moves, adds and deletes with the actor', async () => {
    await PATCH(req('PATCH', { slug: 'host', title: 'T', published: true, note: 'n' }))
    expect(updateLane).toHaveBeenCalledWith('host', expect.objectContaining({ title: 'T', published: true }), ADMIN, 'n')
    await PATCH(req('PATCH', { stepId: 's1', body: 'B' }))
    expect(updateStep).toHaveBeenCalledWith('s1', expect.objectContaining({ body: 'B' }), ADMIN, undefined)
    await PATCH(req('PATCH', { stepId: 's1', move: 'down' }))
    expect(moveStep).toHaveBeenCalledWith('s1', 'down', ADMIN)
    const created = await POST(req('POST', { slug: 'host', title: 'New' }))
    expect(created.status).toBe(201)
    expect(createStep).toHaveBeenCalledWith('host', expect.objectContaining({ title: 'New' }), ADMIN, undefined)
    await DELETE(req('DELETE', { stepId: 's1' }))
    expect(deleteStep).toHaveBeenCalledWith('s1', ADMIN, undefined)
  })

  it('expires the cached public lane links after a successful write, not after a refused one', async () => {
    await PATCH(req('PATCH', { slug: 'host', published: true }))
    await DELETE(req('DELETE', { stepId: 's1' }))
    expect(invalidateLaneLinks).toHaveBeenCalledTimes(2)
    invalidateLaneLinks.mockClear()
    m(updateLane).mockRejectedValue(new LaneEditError(400, 'nope'))
    await PATCH(req('PATCH', { slug: 'host', published: true }))
    expect(invalidateLaneLinks).not.toHaveBeenCalled()
  })

  it('400 without a slug or step id; editor errors map to their status', async () => {
    expect((await PATCH(req('PATCH', {}))).status).toBe(400)
    expect((await POST(req('POST', { title: 'x' }))).status).toBe(400)
    expect((await DELETE(req('DELETE', {}))).status).toBe(400)
    m(updateLane).mockRejectedValue(new LaneEditError(400, 'Add at least one step before publishing'))
    const r = await PATCH(req('PATCH', { slug: 'host', published: true }))
    expect(r.status).toBe(400)
    expect((await r.json()).error).toMatch(/at least one step/)
  })
})
