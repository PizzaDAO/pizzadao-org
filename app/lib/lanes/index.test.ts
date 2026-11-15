// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db')
const unstableCache = vi.fn((fn: () => unknown, ..._rest: unknown[]) => fn)
const revalidateTag = vi.fn()
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown, ...r: unknown[]) => unstableCache(fn, ...r), revalidateTag: (...a: unknown[]) => revalidateTag(...a) }))
const toggleEnabled = vi.fn()
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: (...a: unknown[]) => toggleEnabled(...a) }))

import { prisma } from '@/app/lib/db'
import { getPinnedLaneSummary, getPublicLaneLinks, invalidateLaneLinks, getPublishedLane, pinLane, setStepDone } from './index'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
// The text of a tagged-template raw query call, with ${} holes shown as ?.
const sqlOf = (call: unknown[]) => (call[0] as string[]).join('?').replace(/\s+/g, ' ')

beforeEach(() => {
  vi.clearAllMocks()
  toggleEnabled.mockResolvedValue(true)
})

describe('getPublicLaneLinks', () => {
  it('maps published lanes to their guide link', async () => {
    m(prisma.lane.findMany).mockResolvedValue([{ slug: 'host' }, { slug: 'build' }])
    expect(await getPublicLaneLinks()).toEqual({ host: '/lanes/host?pick=1', build: '/lanes/build?pick=1' })
    expect(m(prisma.lane.findMany).mock.calls[0][0].where).toEqual({ published: true })
  })
  it('is empty while the setting is off, without reading lanes', async () => {
    toggleEnabled.mockResolvedValue(false)
    expect(await getPublicLaneLinks()).toEqual({})
    expect(prisma.lane.findMany).not.toHaveBeenCalled()
  })
  it('fails closed on any read error', async () => {
    m(prisma.lane.findMany).mockRejectedValue(new Error('db down'))
    expect(await getPublicLaneLinks()).toEqual({})
    toggleEnabled.mockRejectedValue(new Error('settings down'))
    expect(await getPublicLaneLinks()).toEqual({})
  })
})

describe('getPublicLaneLinks caching', () => {
  it('caches the lane list with a short TTL and the lane-links tag, but reads the toggle live', async () => {
    m(prisma.lane.findMany).mockResolvedValue([{ slug: 'host' }])
    await getPublicLaneLinks()
    const opts = unstableCache.mock.calls[0][2] as { revalidate: number; tags: string[] }
    expect(opts.tags).toEqual(['lane-links'])
    expect(opts.revalidate).toBeLessThanOrEqual(60)
    toggleEnabled.mockResolvedValue(false)
    expect(await getPublicLaneLinks()).toEqual({})
  })
  it('falls back to a direct read when there is no Next data cache', async () => {
    unstableCache.mockImplementationOnce(() => (() => Promise.reject(new Error('no incrementalCache'))) as never)
    m(prisma.lane.findMany).mockResolvedValue([{ slug: 'build' }])
    expect(await getPublicLaneLinks()).toEqual({ build: '/lanes/build?pick=1' })
  })
  it('invalidateLaneLinks expires the tag and never throws', () => {
    invalidateLaneLinks()
    expect(revalidateTag).toHaveBeenCalledWith('lane-links', { expire: 0 })
    revalidateTag.mockImplementationOnce(() => { throw new Error('outside request') })
    expect(() => invalidateLaneLinks()).not.toThrow()
  })
})

describe('getPublishedLane', () => {
  it('rejects a bad slug without querying and returns null for unpublished/unknown', async () => {
    expect(await getPublishedLane('../x')).toBeNull()
    expect(prisma.lane.findFirst).not.toHaveBeenCalled()
    m(prisma.lane.findFirst).mockResolvedValue(null)
    expect(await getPublishedLane('host')).toBeNull()
    expect(m(prisma.lane.findFirst).mock.calls[0][0].where).toEqual({ slug: 'host', published: true })
  })
})

describe('pinLane', () => {
  it('writes with one INSERT ... ON CONFLICT and a fresh pinnedAt (idempotent, latest pin wins, no P2002 on a first-write race)', async () => {
    m(prisma.lane.findFirst).mockResolvedValue({ slug: 'host' })
    expect(await pinLane('d1', 'host', 'card')).toBe(true)
    const call = m(prisma.$executeRaw).mock.calls[0]
    expect(sqlOf(call)).toContain('INSERT INTO "MemberLane"')
    expect(sqlOf(call)).toContain('ON CONFLICT ("discordId", "laneSlug") DO UPDATE SET "pinnedAt"')
    expect(call.slice(1)).toEqual(expect.arrayContaining(['d1', 'host', 'card']))
    expect(call.slice(1).filter((v) => v instanceof Date)).toHaveLength(3)
    expect(prisma.memberLane.upsert).not.toHaveBeenCalled()
  })
  it('refuses an unpublished or malformed lane and writes nothing', async () => {
    m(prisma.lane.findFirst).mockResolvedValue(null)
    expect(await pinLane('d1', 'host', 'card')).toBe(false)
    expect(await pinLane('d1', 'Bad Slug', 'card')).toBe(false)
    expect(prisma.$executeRaw).not.toHaveBeenCalled()
  })
})

describe('setStepDone', () => {
  const lane = { slug: 'host', steps: [{ id: 's1', kind: 'read' }, { id: 's2', kind: 'do' }, { id: 's3', kind: 'submit' }] }
  it('ticks with one atomic upsert that appends in SQL (no read-modify-write), creating the row on first use', async () => {
    m(prisma.lane.findFirst).mockResolvedValue(lane)
    m(prisma.$queryRaw).mockResolvedValue([{ doneStepIds: ['s2', 's1'] }])
    expect(await setStepDone('d1', 'host', 's1', true)).toEqual(['s2', 's1'])
    const call = m(prisma.$queryRaw).mock.calls[0]
    const sql = sqlOf(call)
    expect(sql).toContain('ON CONFLICT ("discordId", "laneSlug") DO UPDATE')
    expect(sql).toContain('array_append')
    expect(sql).toContain('RETURNING "doneStepIds"')
    expect(call.slice(1)).toEqual(expect.arrayContaining(['d1', 'host', 's1']))
    expect(prisma.memberLane.findUnique).not.toHaveBeenCalled()
    expect(prisma.memberLane.create).not.toHaveBeenCalled()
    expect(prisma.memberLane.update).not.toHaveBeenCalled()
  })
  it('two concurrent ticks each issue their own atomic statement and neither throws', async () => {
    m(prisma.lane.findFirst).mockResolvedValue(lane)
    m(prisma.$queryRaw).mockResolvedValueOnce([{ doneStepIds: ['s1'] }]).mockResolvedValueOnce([{ doneStepIds: ['s1', 's2'] }])
    const [a, b] = await Promise.all([setStepDone('d1', 'host', 's1', true), setStepDone('d1', 'host', 's2', true)])
    expect(a).toEqual(['s1'])
    expect(b).toEqual(['s1', 's2'])
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
  })
  it('unticks with array_remove and drops ids of deleted steps from the result', async () => {
    m(prisma.lane.findFirst).mockResolvedValue(lane)
    m(prisma.$queryRaw).mockResolvedValue([{ doneStepIds: ['s2', 'gone'] }])
    expect(await setStepDone('d1', 'host', 's1', false)).toEqual(['s2'])
    const sql = sqlOf(m(prisma.$queryRaw).mock.calls[0])
    expect(sql).toContain('array_remove')
    expect(sql).toContain('UPDATE "MemberLane"')
    expect(sql).not.toContain('INSERT')
  })
  it('unticking without a row writes nothing and returns []', async () => {
    m(prisma.lane.findFirst).mockResolvedValue(lane)
    m(prisma.$queryRaw).mockResolvedValue([])
    expect(await setStepDone('d1', 'host', 's1', false)).toEqual([])
  })
  it('ignores unknown step ids and submit steps (no write), reporting current ticks', async () => {
    m(prisma.lane.findFirst).mockResolvedValue(lane)
    m(prisma.memberLane.findUnique).mockResolvedValue(null)
    expect(await setStepDone('d1', 'host', 'nope', true)).toEqual([])
    expect(await setStepDone('d1', 'host', 's3', true)).toEqual([])
    m(prisma.memberLane.findUnique).mockResolvedValue({ doneStepIds: ['s1', 'gone'] })
    expect(await setStepDone('d1', 'host', 's3', true)).toEqual(['s1'])
    expect(prisma.$queryRaw).not.toHaveBeenCalled()
  })
  it('null for an unpublished lane', async () => {
    m(prisma.lane.findFirst).mockResolvedValue(null)
    expect(await setStepDone('d1', 'host', 's1', true)).toBeNull()
  })
})

describe('getPinnedLaneSummary', () => {
  it('uses the latest pin with its progress, counting a submitted mission as the submit step', async () => {
    m(prisma.memberLane.findMany).mockResolvedValue([
      { laneSlug: 'build', pinnedAt: new Date('2026-02-01'), doneStepIds: ['x'] },
      { laneSlug: 'host', pinnedAt: new Date('2026-03-01'), doneStepIds: ['a'] },
    ])
    m(prisma.lane.findFirst).mockResolvedValue({
      slug: 'host', tag: 'Host', title: 'Throw a pizza party', missionId: 7,
      steps: [{ id: 'a', kind: 'read' }, { id: 'b', kind: 'submit' }],
    })
    m(prisma.missionCompletion.findUnique).mockResolvedValue({ status: 'PENDING' })
    expect(await getPinnedLaneSummary('d1')).toEqual({ slug: 'host', tag: 'Host', title: 'Throw a pizza party', missionId: 7, done: 2, total: 2, href: '/lanes/host' })
    expect(m(prisma.lane.findFirst).mock.calls[0][0].where).toEqual({ slug: 'host', published: true })
  })
  it('falls back to an older pin when the latest lane was unpublished, and to null when none remain', async () => {
    m(prisma.memberLane.findMany).mockResolvedValue([
      { laneSlug: 'build', pinnedAt: new Date('2026-02-01'), doneStepIds: [] },
      { laneSlug: 'host', pinnedAt: new Date('2026-03-01'), doneStepIds: [] },
    ])
    m(prisma.lane.findFirst).mockResolvedValueOnce(null).mockResolvedValueOnce({ slug: 'build', tag: 'Build', title: 'B', missionId: null, steps: [] })
    expect((await getPinnedLaneSummary('d1'))?.slug).toBe('build')
    m(prisma.lane.findFirst).mockResolvedValue(null)
    expect(await getPinnedLaneSummary('d1')).toBeNull()
  })
  it('null when nothing is pinned or the read fails', async () => {
    m(prisma.memberLane.findMany).mockResolvedValue([])
    expect(await getPinnedLaneSummary('d1')).toBeNull()
    m(prisma.memberLane.findMany).mockRejectedValue(new Error('x'))
    expect(await getPinnedLaneSummary('d1')).toBeNull()
  })
})
