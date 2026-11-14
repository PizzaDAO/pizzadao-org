// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  toggle: vi.fn(),
  overview: vi.fn(),
  createPair: vi.fn(),
  endPair: vi.fn(),
  addBuddy: vi.fn(),
  removeBuddy: vi.fn(),
  complete: vi.fn(),
  introduce: vi.fn(),
}))

vi.mock('@/app/lib/auth-guards', () => ({ requireAdmin: m.requireAdmin, requireSession: vi.fn() }))
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: m.toggle }))
vi.mock('@/app/lib/buddy/view', () => ({ getAdminOverview: m.overview }))
vi.mock('@/app/lib/buddy/intro', () => ({ introducePair: m.introduce }))
vi.mock('@/app/lib/buddy/service', async () => ({
  isSnowflake: (v: unknown) => typeof v === 'string' && /^\d{5,25}$/.test(v),
  createPair: m.createPair,
  endPair: m.endPair,
  adminAddBuddy: m.addBuddy,
  adminRemoveBuddy: m.removeBuddy,
  completeDuePairs: m.complete,
}))

import { GET, POST } from './route'

const denied = (status: number) => ({ ok: false, response: new Response(JSON.stringify({ error: 'no' }), { status }) })
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/admin/buddies', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  m.requireAdmin.mockResolvedValue({ ok: true, session: { discordId: '999999' } })
  m.toggle.mockResolvedValue(true)
  m.overview.mockResolvedValue({ buddies: [] })
  m.introduce.mockResolvedValue({ mode: 'dry-run', ok: true })
})

describe('admin auth', () => {
  it('GET: 401 without a session and 403 for non-admins, never reading data', async () => {
    m.requireAdmin.mockResolvedValue(denied(401))
    expect((await GET()).status).toBe(401)
    m.requireAdmin.mockResolvedValue(denied(403))
    expect((await GET()).status).toBe(403)
    expect(m.overview).not.toHaveBeenCalled()
  })
  it('POST: 401/403 for every action and nothing is written', async () => {
    for (const status of [401, 403]) {
      m.requireAdmin.mockResolvedValue(denied(status))
      for (const body of [
        { action: 'pair', traineeDiscordId: '111111', buddyDiscordId: '222222' },
        { action: 'end', pairId: 'p1' },
        { action: 'addBuddy', discordId: '222222' },
        { action: 'removeBuddy', discordId: '222222' },
        { action: 'introduce', pairId: 'p1' },
        { action: 'completeDue' },
      ]) {
        expect((await POST(post(body))).status).toBe(status)
      }
    }
    for (const fn of [m.createPair, m.endPair, m.addBuddy, m.removeBuddy, m.introduce, m.complete]) expect(fn).not.toHaveBeenCalled()
  })
  it('POST: rejects cross-origin and non-JSON writes even for admins', async () => {
    expect((await POST(post({ action: 'completeDue' }, { origin: 'https://evil.example', host: 'app.example' }))).status).toBe(403)
    const form = new Request('http://localhost/api/admin/buddies', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })
    expect((await POST(form)).status).toBe(415)
    expect(m.complete).not.toHaveBeenCalled()
  })
})

describe('admin actions', () => {
  it('answers 409 while the system is off', async () => {
    m.toggle.mockResolvedValue(false)
    expect((await POST(post({ action: 'completeDue' }))).status).toBe(409)
    expect(m.complete).not.toHaveBeenCalled()
  })
  it('pairs, then introduces (a dry run when threads are off)', async () => {
    m.createPair.mockResolvedValue({ ok: true, pairId: 'p1', traineeMemberId: null })
    const res = await POST(post({ action: 'pair', traineeDiscordId: '111111', buddyDiscordId: '222222' }))
    expect(res.status).toBe(200)
    expect(m.createPair).toHaveBeenCalledWith({ traineeDiscordId: '111111', buddyDiscordId: '222222' }, '999999')
    expect(await res.json()).toMatchObject({ ok: true, pairId: 'p1', intro: { mode: 'dry-run' } })
  })
  it('a refused pair is a 409 with the reason and no intro', async () => {
    m.createPair.mockResolvedValue({ ok: false, reason: 'buddy_full' })
    const res = await POST(post({ action: 'pair', traineeDiscordId: '111111', buddyDiscordId: '222222' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ reason: 'buddy_full' })
    expect(m.introduce).not.toHaveBeenCalled()
  })
  it('validates ids and the action name', async () => {
    expect((await POST(post({ action: 'pair', traineeDiscordId: 'x', buddyDiscordId: '222222' }))).status).toBe(400)
    expect((await POST(post({ action: 'nope' }))).status).toBe(400)
  })
  it('ends a pair and reports one that is not active', async () => {
    m.endPair.mockResolvedValue({ ok: true })
    expect((await POST(post({ action: 'end', pairId: 'p1', reason: 'x' }))).status).toBe(200)
    m.endPair.mockResolvedValue({ ok: false })
    expect((await POST(post({ action: 'end', pairId: 'p1' }))).status).toBe(409)
  })
})
