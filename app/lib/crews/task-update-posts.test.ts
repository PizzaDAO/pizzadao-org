import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  events: vi.fn(),
  marks: vi.fn(),
  markCreate: vi.fn(),
  markUpdateMany: vi.fn(),
  markDeleteMany: vi.fn(),
  tasks: vi.fn(),
  toggle: vi.fn(),
  filter: vi.fn(),
  crews: vi.fn(),
  exec: vi.fn(),
  minutes: { value: 60 },
}))

vi.mock('@/app/lib/db', () => ({
  prisma: {
    $executeRaw: m.exec,
    crewTaskEvent: { findMany: m.events },
    crewTask: { findMany: m.tasks },
    crewTaskUpdatePost: { findMany: m.marks, create: m.markCreate, updateMany: m.markUpdateMany, deleteMany: m.markDeleteMany },
  },
}))
vi.mock('@/app/lib/crew-mappings', () => ({ getCrewMappings: m.crews }))
vi.mock('@/app/lib/calls/recap', () => ({ resolveRecapChannel: vi.fn() }))
vi.mock('@/app/lib/calls/post-filters', async () => {
  const actual = await vi.importActual<typeof import('@/app/lib/calls/post-filters')>('@/app/lib/calls/post-filters')
  return { ...actual, loadPostFilter: m.filter }
})
vi.mock('@/app/lib/settings', () => ({ loadSettings: async () => ({ get: () => m.minutes.value }) }))
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: m.toggle }))

import { DiscordPostError } from '@/app/lib/discord-rest'
import { digestText, MAX_DIGEST_LINES, runCrewTaskUpdatePosts, stageKind, summarizeEvents, type TaskEventRow } from './task-update-posts'

const NOW = new Date('2026-11-12T12:00:00Z')
const prod = { VERCEL_ENV: 'production', DISCORD_BOT_TOKEN: 'tok' }
const ev = (id: number, taskId: string, action: string, data: unknown = {}, crewId = 'ops', minsAgo = 5): TaskEventRow => ({
  id, taskId, crewId, action, data, createdAt: new Date(NOW.getTime() - minsAgo * 60_000),
})
const task = (id: string, label = `Task ${id}`, leadName: string | null = null) => ({ id, label, leadName })

let post: ReturnType<typeof vi.fn>
let resolveChannel: ReturnType<typeof vi.fn>
const run = (env: Record<string, string | undefined> = prod) => runCrewTaskUpdatePosts({ now: NOW, env, post: post as never, resolveChannel: resolveChannel as never })

beforeEach(() => {
  vi.clearAllMocks()
  m.minutes.value = 60
  m.exec.mockResolvedValue(1)
  m.toggle.mockResolvedValue(true)
  m.filter.mockResolvedValue({ excludedCrewIds: [], excludedCrewLabelTerms: [], blockedTerms: [] })
  m.crews.mockResolvedValue({ crews: [{ id: 'ops', label: 'Ops' }, { id: 'comms', label: 'Comms' }] })
  m.marks.mockResolvedValue([])
  m.events.mockResolvedValue([ev(1, 't1', 'create', { label: 'Plan the thing' })])
  m.tasks.mockResolvedValue([task('t1', 'Plan the thing')])
  m.markCreate.mockResolvedValue({})
  m.markUpdateMany.mockResolvedValue({ count: 1 })
  post = vi.fn().mockResolvedValue({ id: 'msg' })
  resolveChannel = vi.fn().mockResolvedValue({ channelId: '123', label: '#ops' })
})

describe('summarizeEvents', () => {
  it('reports created, Doing, Done and lead changes, and ignores the rest', () => {
    const tasks = new Map([task('a'), task('b'), task('c'), task('d', 'D', 'Tony')].map((t) => [t.id, t]))
    const out = summarizeEvents(
      [
        ev(1, 'a', 'create'),
        ev(2, 'b', 'update', { changes: { stage: 'Doing' } }),
        ev(3, 'c', 'update', { changes: { notes: 'x', priority: 'High' } }),
        ev(4, 'd', 'claim'),
        ev(5, 'a', 'update', { changes: { stage: 'Done', leadName: 'Sal' } }),
        ev(6, 'gone', 'create'),
        ev(7, 'b', 'archive'),
      ],
      tasks,
    )
    expect(out).toEqual([
      { taskId: 'a', label: 'Task a', created: true, stage: 'done', lead: 'Sal' },
      { taskId: 'b', label: 'Task b', created: false, stage: 'doing', lead: null },
      { taskId: 'd', label: 'D', created: false, stage: null, lead: 'Tony' },
    ])
  })

  it('maps stages', () => {
    expect(stageKind('Doing')).toBe('doing')
    expect(stageKind('In Progress')).toBe('doing')
    expect(stageKind('Done')).toBe('done')
    expect(stageKind('todo')).toBeNull()
    expect(stageKind('skip')).toBeNull()
  })
})

describe('digestText', () => {
  it('caps the lines, links the crew page and keeps emoji labels whole', () => {
    const many = Array.from({ length: MAX_DIGEST_LINES + 3 }, (_, i) => ({ taskId: String(i), label: `T${i}`, created: true, stage: null, lead: null }))
    const text = digestText('Ops', 'ops', many, 'https://x.test')
    expect(text.split('\n')).toHaveLength(MAX_DIGEST_LINES + 3)
    expect(text).toContain('…and 3 more')
    expect(text.endsWith('https://x.test/crew/ops')).toBe(true)
    const long = digestText('Ops', 'ops', [{ taskId: 'x', label: `${'a'.repeat(79)}\u{1F468}‍\u{1F469}`, created: true, stage: null, lead: null }], 'https://x.test')
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(long)).toBe(false)
  })
})

describe('runCrewTaskUpdatePosts', () => {
  it('does nothing when off, and never queries or posts', async () => {
    m.toggle.mockResolvedValue(false)
    expect((await run()).status).toBe('disabled')
    expect(m.events).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })

  it('while off in production it moves the watermarks to the latest event, so turning it on never dumps history', async () => {
    m.toggle.mockResolvedValue(false)
    await run()
    expect(m.exec).toHaveBeenCalledTimes(1)
    expect((m.exec.mock.calls[0][0] as string[]).join('')).toContain('MAX("id")')
  })

  it('a preview never writes the watermarks', async () => {
    m.toggle.mockResolvedValue(false)
    await run({ ...prod, VERCEL_ENV: 'preview' })
    expect(m.exec).not.toHaveBeenCalled()
  })

  it('filters events in SQL per crew watermark', async () => {
    m.marks.mockResolvedValue([{ crewId: 'ops', lastEventId: 7, postedAt: NOW }])
    await run()
    const where = m.events.mock.calls[0][0].where
    expect(where.OR).toContainEqual({ crewId: 'ops', id: { gt: 7 } })
    expect(where.OR).toContainEqual(expect.objectContaining({ crewId: { notIn: ['ops'] } }))
  })

  it('never posts on a preview, even with the switch on', async () => {
    expect((await run({ ...prod, VERCEL_ENV: 'preview' })).status).toBe('disabled')
    expect((await run({ DISCORD_BOT_TOKEN: 'tok' })).status).toBe('disabled')
    expect(post).not.toHaveBeenCalled()
  })

  it('posts one digest with no pings and claims the watermark first', async () => {
    const r = await run()
    expect(r.outcomes).toEqual([{ crewId: 'ops', status: 'posted', count: 1 }])
    expect(m.markCreate).toHaveBeenCalledWith({ data: { crewId: 'ops', lastEventId: 1, postedAt: NOW } })
    expect(post).toHaveBeenCalledTimes(1)
    const [target, body] = post.mock.calls[0]
    expect(target).toEqual({ kind: 'bot', channelId: '123', botToken: 'tok' })
    expect(body.allowed_mentions).toEqual({ parse: [] })
    expect(body.content).toContain('Plan the thing')
    expect(body.content).toContain('/crew/ops')
    expect(m.markCreate.mock.invocationCallOrder[0]).toBeLessThan(post.mock.invocationCallOrder[0])
  })

  it('batches: one crew with several changes gets one post', async () => {
    m.events.mockResolvedValue([ev(1, 't1', 'create'), ev(2, 't2', 'update', { changes: { stage: 'Doing' } }), ev(3, 't1', 'update', { changes: { stage: 'Done' } })])
    m.tasks.mockResolvedValue([task('t1'), task('t2')])
    await run()
    expect(post).toHaveBeenCalledTimes(1)
    expect(post.mock.calls[0][1].content).toContain('Task t1 (new, done)')
    expect(post.mock.calls[0][1].content).toContain('Task t2 (doing)')
  })

  it('waits while the last digest is newer than the interval', async () => {
    m.marks.mockResolvedValue([{ crewId: 'ops', lastEventId: 0, postedAt: new Date(NOW.getTime() - 30 * 60_000) }])
    expect((await run()).outcomes).toEqual([{ crewId: 'ops', status: 'waiting' }])
    expect(post).not.toHaveBeenCalled()
  })

  it('posts once the interval has passed, only for events after the watermark', async () => {
    m.marks.mockResolvedValue([{ crewId: 'ops', lastEventId: 1, postedAt: new Date(NOW.getTime() - 90 * 60_000) }])
    m.events.mockResolvedValue([ev(1, 't1', 'create'), ev(2, 't2', 'create')])
    m.tasks.mockResolvedValue([task('t2')])
    await run()
    expect(m.markUpdateMany).toHaveBeenCalledWith({ where: { crewId: 'ops', lastEventId: 1 }, data: { lastEventId: 2, postedAt: NOW } })
    expect(post.mock.calls[0][1].content).toContain('Task t2')
  })

  it('does not backfill history for a crew with no digest yet', async () => {
    m.events.mockResolvedValue([ev(1, 't1', 'create', {}, 'ops', 600)])
    expect((await run()).outcomes).toEqual([])
    expect(post).not.toHaveBeenCalled()
  })

  it('skips excluded crews without claiming', async () => {
    m.filter.mockResolvedValue({ excludedCrewIds: ['ops'], excludedCrewLabelTerms: [], blockedTerms: [] })
    expect((await run()).outcomes).toEqual([{ crewId: 'ops', status: 'excluded' }])
    expect(m.markCreate).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })

  it('leaves events for later when the crew has no channel', async () => {
    resolveChannel.mockResolvedValue(null)
    expect((await run()).outcomes).toEqual([{ crewId: 'ops', status: 'no-channel' }])
    expect(m.markCreate).not.toHaveBeenCalled()
  })

  it('moves past changes that are not worth a post without posting', async () => {
    m.events.mockResolvedValue([ev(4, 't1', 'update', { changes: { notes: 'x' } })])
    expect((await run()).outcomes).toEqual([{ crewId: 'ops', status: 'nothing' }])
    expect(post).not.toHaveBeenCalled()
    expect(m.markCreate).toHaveBeenCalledWith({ data: { crewId: 'ops', lastEventId: 4, postedAt: new Date(0) } })
  })

  it('does not post twice when another run claimed the watermark', async () => {
    m.markCreate.mockRejectedValue(new Error('unique'))
    expect((await run()).outcomes).toEqual([{ crewId: 'ops', status: 'already' }])
    expect(post).not.toHaveBeenCalled()
  })

  it('releases the claim when Discord refuses, keeps it when the outcome is unknown', async () => {
    post.mockRejectedValue(new DiscordPostError('nope', 403))
    expect((await run()).outcomes[0].status).toBe('failed')
    expect(m.markDeleteMany).toHaveBeenCalledWith({ where: { crewId: 'ops', lastEventId: 1 } })
    m.markDeleteMany.mockClear()
    post.mockRejectedValue(new Error('timeout'))
    expect((await run()).outcomes[0].status).toBe('post-uncertain')
    expect(m.markDeleteMany).not.toHaveBeenCalled()
  })

  it('one crew failing does not stop the next', async () => {
    m.events.mockResolvedValue([ev(1, 't1', 'create', {}, 'ops'), ev(2, 't2', 'create', {}, 'comms')])
    m.tasks.mockResolvedValueOnce([task('t1')]).mockResolvedValueOnce([task('t2')])
    resolveChannel.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ channelId: '9', label: '#c' })
    const r = await run()
    expect(r.outcomes.map((o) => o.status)).toEqual(['error', 'posted'])
  })
})
