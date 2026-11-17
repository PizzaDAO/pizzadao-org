// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  session: null as { discordId: string } | null,
  member: { discordId: 'd1' } as { discordId: string } | null,
  extras: null as Record<string, unknown> | null,
  cfg: { enabled: true, countTickets: true },
  load: vi.fn(),
  hidden: false,
}))
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn(async () => h.session) }))
vi.mock('@/app/lib/auth-guards', () => ({
  requireSession: vi.fn(async () => (h.session ? { ok: true, session: h.session } : { ok: false, response: new Response('{}', { status: 401 }) })),
}))
vi.mock('@/app/lib/db', () => ({ prisma: { memberProfileExtras: { findUnique: vi.fn(async () => h.extras) } } }))
vi.mock('@/app/lib/sheets/member-repository', () => ({ fetchMemberById: vi.fn(async () => h.member) }))
vi.mock('@/app/lib/member-utils', () => ({ findMemberIdByDiscordId: vi.fn(async () => '42') }))
vi.mock('@/app/lib/events-attended/config', () => ({ loadEventsAttendedConfig: vi.fn(async () => h.cfg) }))
vi.mock('@/app/lib/events-attended', () => ({ loadEventsAttended: h.load, isHiddenSubject: vi.fn(async () => h.hidden) }))

import { GET } from './route'
import { GET as ME } from '../me/route'

const call = () => GET(new Request('https://x/api/events-attended/42'), { params: Promise.resolve({ memberId: '42' }) })
const events = [{ id: 'rsv:1', name: 'Party', date: null, year: 2026, city: 'Rome', url: null, badge: 'attended' }]

beforeEach(() => {
  h.session = null
  h.member = { discordId: 'd1' }
  h.extras = { eventsVisibility: 'public', email: null, emailVerifiedAt: null, rsvLinkedEmailHash: null }
  h.cfg = { enabled: true, countTickets: true }
  h.hidden = false
  h.load.mockReset()
  h.load.mockResolvedValue({ events, total: 1 })
})

describe('GET /api/events-attended/[memberId] (visitor view)', () => {
  it('answers enabled:false and reads nothing while the feature is off', async () => {
    h.cfg.enabled = false
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: false, events: [], total: 0 })
    expect(h.load).not.toHaveBeenCalled()
  })

  it('returns an empty list (200) for a missing or disavowed member', async () => {
    h.member = null
    expect(await (await call()).json()).toEqual({ enabled: true, events: [], total: 0 })
    h.member = { discordId: 'd1' }
    h.hidden = true
    expect(await (await call()).json()).toEqual({ enabled: true, events: [], total: 0 })
  })

  it('hides private and members-only lists from anonymous visitors', async () => {
    h.extras = { eventsVisibility: 'private' }
    expect((await (await call()).json()).events).toEqual([])
    h.extras = { eventsVisibility: 'members' }
    expect((await (await call()).json()).events).toEqual([])
    h.session = { discordId: 'other' }
    expect((await (await call()).json()).events).toHaveLength(1)
  })

  it('never returns owner data, even to the owner, and never loads hidden guest lists', async () => {
    h.extras = { eventsVisibility: 'public', email: 'a@x.io', emailVerifiedAt: null, rsvLinkedEmailHash: 'h' }
    h.session = { discordId: 'd1' } // the owner, on the cacheable route
    const body = await (await call()).json()
    expect(body.isOwner).toBe(false)
    expect(body.emailState).toBeUndefined()
    expect(body.link).toBeUndefined()
    expect(body.visibility).toBeUndefined()
    expect(h.load).toHaveBeenLastCalledWith('42', 'd1', { countTickets: true, viewerIsOwner: false })
  })

  it('caches only public lists, briefly, and never members-only or private ones', async () => {
    const cc = (await call()).headers.get('cache-control')!
    expect(cc).toBe('public, s-maxage=60')
    expect(cc).not.toContain('stale-while-revalidate')
    h.extras = { eventsVisibility: 'members' }
    h.session = { discordId: 'other' }
    expect((await call()).headers.get('cache-control')).toBe('private, no-store')
  })
})

describe('GET /api/events-attended/me (owner view)', () => {
  it('requires a session', async () => {
    expect((await ME()).status).toBe(401)
  })

  it('always gives the owner isOwner:true with the controls, never cached, from the session id', async () => {
    h.session = { discordId: 'd1' }
    h.extras = { eventsVisibility: 'private', email: 'a@x.io', emailVerifiedAt: null, rsvLinkedEmailHash: 'h' }
    const res = await ME()
    const body = await res.json()
    expect(body).toMatchObject({ enabled: true, isOwner: true, visibility: 'private', emailState: 'unverified', link: { available: true, linked: true } })
    expect(body.events).toHaveLength(1) // the owner sees their own list whatever the visibility
    expect(res.headers.get('cache-control')).toMatch(/no-store/)
    expect(h.load).toHaveBeenLastCalledWith('42', 'd1', { countTickets: true, viewerIsOwner: true })
  })

  it('is empty for a disavowed member and answers enabled:false when off', async () => {
    h.session = { discordId: 'd1' }
    h.hidden = true
    expect(await (await ME()).json()).toEqual({ enabled: true, events: [], total: 0 })
    h.hidden = false
    h.cfg.enabled = false
    expect((await (await ME()).json()).enabled).toBe(false)
  })
})
