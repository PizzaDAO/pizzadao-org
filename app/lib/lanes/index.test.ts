// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db')
const toggleEnabled = vi.fn()
vi.mock('@/app/lib/settings/toggles', () => ({ toggleEnabled: (...a: unknown[]) => toggleEnabled(...a) }))

import { prisma } from '@/app/lib/db'
import { getPinnedLaneSummary, getPublicLaneLinks, getPublishedLane, pinLane, setStepDone } from './index'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>

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
  it('upserts with a fresh pinnedAt (idempotent, latest pin wins)', async () => {
    m(prisma.lane.findFirst).mockResolvedValue({ slug: 'host' })
    expect(await pinLane('d1', 'host', 'card')).toBe(true)
    const call = m(prisma.memberLane.upsert).mock.calls[0][0]
    expect(call.where).toEqual({ discordId_laneSlug: { discordId: 'd1', laneSlug: 'host' } })
    expect(call.create).toMatchObject({ discordId: 'd1', laneSlug: 'host', source: 'card' })
    expect(call.create.pinnedAt).toBeInstanceOf(Date)
    expect(call.update.pinnedAt).toBeInstanceOf(Date)
  })
  it('refuses an unpublished or malformed lane and writes nothing', async () => {
    m(prisma.lane.findFirst).mockResolvedValue(null)
    expect(await pinLane('d1', 'host', 'card')).toBe(false)
    expect(await pinLane('d1', 'Bad Slug', 'card')).toBe(false)
    expect(prisma.memberLane.upsert).not.toHaveBeenCalled()
  })
})

describe('setStepDone', () => {
  const lane = { slug: 'host', steps: [{ id: 's1', kind: 'read' }, { id: 's2', kind: 'do' }, { id: 's3', kind: 'submit' }] }
  it('ticks a step, creating the row on first use', async () => {
    m(prisma.lane.findFirst).mockResolvedValue(lane)
    m(prisma.memberLane.findUnique).mockResolvedValue(null)
    expect(await setStepDone('d1', 'host', 's1', true)).toEqual(['s1'])
    expect(m(prisma.memberLane.create).mock.calls[0][0].data).toMatchObject({ discordId: 'd1', laneSlug: 'host', doneStepIds: ['s1'] })
  })
  it('ignores unknown step ids and submit steps (writes nothing for a fresh member)', async () => {
    m(prisma.lane.findFirst).mockResolvedValue(lane)
    m(prisma.memberLane.findUnique).mockResolvedValue(null)
    expect(await setStepDone('d1', 'host', 'nope', true)).toEqual([])
    expect(await setStepDone('d1', 'host', 's3', true)).toEqual([])
    expect(prisma.memberLane.create).not.toHaveBeenCalled()
  })
  it('unticks on an existing row and drops ids of deleted steps', async () => {
    m(prisma.lane.findFirst).mockResolvedValue(lane)
    m(prisma.memberLane.findUnique).mockResolvedValue({ doneStepIds: ['s1', 'gone'] })
    expect(await setStepDone('d1', 'host', 's1', false)).toEqual([])
    expect(m(prisma.memberLane.update).mock.calls[0][0].data).toEqual({ doneStepIds: [] })
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
