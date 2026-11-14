import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findMany, findFirst } = vi.hoisted(() => ({ findMany: vi.fn(), findFirst: vi.fn() }))
vi.mock('@/app/lib/db', () => ({ prisma: { crewSession: { findMany, findFirst } } }))

import { getPublicSession, listPublicSessions, nextPublicSession, PUBLIC_WHERE, toPublic } from './public'

const row = (over = {}) => ({
  id: 's1',
  title: 'Intro',
  presenter: 'A. Baker',
  description: 'D',
  startsAt: new Date('2026-11-20T18:00:00Z'),
  endsAt: new Date('2026-11-20T19:00:00Z'),
  timeZone: 'UTC',
  eventId: '999001',
  recordingUrl: null,
  ...over,
})
const NOW = new Date('2026-11-14T00:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  process.env.DISCORD_GUILD_ID = '555555'
  findMany.mockResolvedValue([])
})

describe('the public filter', () => {
  it('only lists scheduled, public, not-canceled sessions', () => {
    expect(PUBLIC_WHERE).toEqual({ status: 'SCHEDULED', canceledAt: null, public: true })
  })
  it('upcoming and past both apply the filter, split at now, and use the right order', async () => {
    await listPublicSessions(NOW, 5)
    const [up, past] = findMany.mock.calls.map((c) => c[0])
    expect(up.where).toEqual({ ...PUBLIC_WHERE, endsAt: { gte: NOW } })
    expect(up.orderBy).toEqual({ startsAt: 'asc' })
    expect(past.where).toEqual({ ...PUBLIC_WHERE, endsAt: { lt: NOW } })
    expect(past.orderBy).toEqual({ startsAt: 'desc' })
    expect(past.take).toBe(5)
  })
  it('a single lookup and the next-session lookup apply it too', async () => {
    findFirst.mockResolvedValue(null)
    expect(await getPublicSession('s1')).toBeNull()
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: 's1', ...PUBLIC_WHERE })
    await nextPublicSession(NOW)
    expect(findFirst.mock.calls[1][0].where).toEqual({ ...PUBLIC_WHERE, endsAt: { gte: NOW } })
  })
  it('selects only public fields (no creator, error text or message ids)', async () => {
    await listPublicSessions(NOW)
    const select = findMany.mock.calls[0][0].select as Record<string, boolean>
    for (const hidden of ['createdBy', 'lastError', 'announceMessageId', 'generalMessageId', 'updatedBy', 'proposedBy', 'dedupeKey']) expect(select[hidden]).toBeUndefined()
  })
})

describe('toPublic', () => {
  it('builds the Discord event link only when there is a real event id', () => {
    expect(toPublic(row(), '555555').eventUrl).toBe('https://discord.com/events/555555/999001')
    expect(toPublic(row({ eventId: null }), '555555').eventUrl).toBeNull()
    expect(toPublic(row({ eventId: 'PENDING' }), '555555').eventUrl).toBeNull()
    expect(toPublic(row(), null).eventUrl).toBeNull()
  })
  it('passes the recording link and drops internal fields', () => {
    const p = toPublic({ ...row({ recordingUrl: 'https://example.org/r' }), createdBy: 'u1', lastError: 'x' } as never, '555555')
    expect(p.recordingUrl).toBe('https://example.org/r')
    expect(Object.keys(p)).not.toContain('createdBy')
    expect(Object.keys(p)).not.toContain('lastError')
  })
})
