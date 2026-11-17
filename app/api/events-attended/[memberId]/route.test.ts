// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  session: null as { discordId: string } | null,
  member: { discordId: 'd1' } as { discordId: string } | null,
  extras: null as Record<string, unknown> | null,
  cfg: { enabled: true, countTickets: true, rsvLinkUrl: '' },
  load: vi.fn(),
}))
vi.mock('@/app/lib/session', () => ({ getSession: vi.fn(async () => h.session) }))
vi.mock('@/app/lib/db', () => ({ prisma: { memberProfileExtras: { findUnique: vi.fn(async () => h.extras) } } }))
vi.mock('@/app/lib/sheets/member-repository', () => ({ fetchMemberById: vi.fn(async () => h.member) }))
vi.mock('@/app/lib/events-attended/config', () => ({ loadEventsAttendedConfig: vi.fn(async () => h.cfg) }))
const hidden = vi.hoisted(() => ({ v: false }))
vi.mock('@/app/lib/events-attended', () => ({ loadEventsAttended: h.load, isHiddenSubject: vi.fn(async () => hidden.v) }))

import { GET } from './route'

const call = () => GET(new Request('https://x/api/events-attended/42'), { params: Promise.resolve({ memberId: '42' }) })
const events = [{ id: 'rsv:1', name: 'Party', date: null, year: 2026, city: 'Rome', url: null, badge: 'attended' }]

beforeEach(() => {
  h.session = null
  h.member = { discordId: 'd1' }
  h.extras = { eventsVisibility: 'public', email: null, emailVerifiedAt: null, rsvLinkedEmailHash: null }
  h.cfg = { enabled: true, countTickets: true, rsvLinkUrl: '' }
  hidden.v = false
  h.load.mockReset()
  h.load.mockResolvedValue({ events, total: 1 })
})

describe('GET /api/events-attended/[memberId]', () => {
  it('answers enabled:false and reads nothing while the feature is off', async () => {
    h.cfg.enabled = false
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: false, events: [], total: 0 })
    expect(h.load).not.toHaveBeenCalled()
  })

  it('returns an empty list (200) for a missing member', async () => {
    h.member = null
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: true, events: [], total: 0 })
  })

  it('returns an empty list for a disavowed member, even to the owner', async () => {
    hidden.v = true
    h.session = { discordId: 'd1' }
    expect(await (await call()).json()).toEqual({ enabled: true, events: [], total: 0 })
  })

  it('hides a private list from anonymous visitors, and members-only from anonymous', async () => {
    h.extras = { eventsVisibility: 'private' }
    expect((await (await call()).json()).events).toEqual([])
    h.extras = { eventsVisibility: 'members' }
    expect((await (await call()).json()).events).toEqual([])
    h.session = { discordId: 'other' }
    expect((await (await call()).json()).events).toHaveLength(1)
  })

  it('gives emailState and the link state to the owner only', async () => {
    h.extras = { eventsVisibility: 'private', email: 'a@x.io', emailVerifiedAt: null, rsvLinkedEmailHash: 'h' }
        h.session = { discordId: 'd1' }
    const owner = await (await call()).json()
    expect(owner).toMatchObject({ isOwner: true, emailState: 'unverified', visibility: 'private', link: { available: true, linked: true } })
    expect(owner.events).toHaveLength(1) // the owner always sees their own list
    h.session = { discordId: 'someone' }
    h.extras = { eventsVisibility: 'public', email: 'a@x.io' }
    const other = await (await call()).json()
    expect(other.emailState).toBeUndefined()
    expect(other.link).toBeUndefined()
  })

  it('tells the loader whether the viewer is the owner (hidden guest lists)', async () => {
    await call()
    expect(h.load).toHaveBeenLastCalledWith('42', 'd1', { countTickets: true, viewerIsOwner: false })
    h.session = { discordId: 'd1' }
    await call()
    expect(h.load).toHaveBeenLastCalledWith('42', 'd1', { countTickets: true, viewerIsOwner: true })
  })

  it('caches public views for others and never caches the owner or hidden views', async () => {
    expect((await call()).headers.get('cache-control')).toContain('s-maxage=300')
    h.extras = { eventsVisibility: 'members' }
    h.session = { discordId: 'other' }
    expect((await call()).headers.get('cache-control')).toBe('private, no-store')
    h.session = { discordId: 'd1' }
    expect((await call()).headers.get('cache-control')).not.toContain('s-maxage')
  })
})
