// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ requireSession: vi.fn(), state: vi.fn(), save: vi.fn() }))

vi.mock('@/app/lib/auth-guards', () => ({ requireSession: m.requireSession }))
vi.mock('@/app/lib/buddy/view', () => ({ getMyBuddyState: m.state }))
vi.mock('@/app/lib/buddy/service', () => ({ saveOwnProfile: m.save }))

import { GET, POST } from './route'

const post = (body: unknown) =>
  new Request('http://localhost/api/buddy/me', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  m.requireSession.mockResolvedValue({ ok: true, session: { discordId: '222222' } })
})

describe('/api/buddy/me', () => {
  it('requires a session', async () => {
    m.requireSession.mockResolvedValue({ ok: false, response: new Response('{}', { status: 401 }) })
    expect((await GET()).status).toBe(401)
    expect((await POST(post({ active: true }))).status).toBe(401)
    expect(m.state).not.toHaveBeenCalled()
    expect(m.save).not.toHaveBeenCalled()
  })
  it('returns the caller\'s own state only', async () => {
    m.state.mockResolvedValue({ enabled: true })
    expect((await GET()).status).toBe(200)
    expect(m.state).toHaveBeenCalledWith('222222')
  })
  it('opt-in below the level is a 403, the system being off a 404', async () => {
    m.save.mockResolvedValue({ ok: false, reason: 'not_eligible' })
    expect((await POST(post({ active: true }))).status).toBe(403)
    m.save.mockResolvedValue({ ok: false, reason: 'disabled' })
    expect((await POST(post({ active: true }))).status).toBe(404)
  })
  it('passes only the caller id and typed fields to the service', async () => {
    m.save.mockResolvedValue({ ok: true, profile: {} })
    await POST(post({ active: true, paused: 'yes', maxActive: 2, discordId: '999999' }))
    expect(m.save).toHaveBeenCalledWith('222222', { active: true, paused: undefined, maxActive: 2, languages: undefined })
  })
})
