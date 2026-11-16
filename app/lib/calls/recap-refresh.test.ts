// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/calls/recap', () => ({ repostRecap: vi.fn(async () => 'updated') }))

import { prisma } from '@/app/lib/db'
import { repostRecap } from '@/app/lib/calls/recap'
import { refreshDueRecaps, requestRecapRefresh } from './recap-refresh'

const db = prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>
const NOW = new Date('2026-12-01T12:00:00Z')
const min = (n: number) => new Date(NOW.getTime() + n * 60_000)
const due = (over: Record<string, unknown> = {}) => ({ id: 'rec1', recapRefreshAt: min(-5), recapEditedAt: null, recapError: null, ...over })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(repostRecap).mockResolvedValue('updated')
  db.appSetting.findMany.mockResolvedValue([])
  db.callRecording.updateMany.mockResolvedValue({ count: 1 })
  db.callRecording.findMany.mockResolvedValue([])
  vi.stubEnv('CALL_RECAP_LIVE_STATUS_ENABLED', '1')
})
afterEach(() => vi.unstubAllEnvs())

describe('requestRecapRefresh', () => {
  it('is a no-op while live status is off', async () => {
    vi.stubEnv('CALL_RECAP_LIVE_STATUS_ENABLED', '')
    expect(await requestRecapRefresh('rec1', 'test', NOW)).toBe(false)
    expect(db.callRecording.updateMany).not.toHaveBeenCalled()
  })

  it('schedules one edit after the delay, only for a published, posted recap with no pending time', async () => {
    expect(await requestRecapRefresh('rec1', 'test', NOW)).toBe(true)
    expect(db.callRecording.updateMany).toHaveBeenCalledWith({
      where: { id: 'rec1', status: 'PUBLISHED', recapMessageId: { not: null }, recapRefreshAt: null },
      data: { recapRefreshAt: min(10) },
    })
  })

  it('a burst of requests keeps the earliest time (the guard is "no pending time")', async () => {
    db.callRecording.updateMany.mockResolvedValue({ count: 0 })
    expect(await requestRecapRefresh('rec1', 'test', NOW)).toBe(false)
  })

  it('never throws: a database error is logged and reported as false', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    db.callRecording.updateMany.mockRejectedValue(new Error('db down'))
    await expect(requestRecapRefresh('rec1', 'test', NOW)).resolves.toBe(false)
  })
})

describe('refreshDueRecaps', () => {
  it('does nothing while live status is off', async () => {
    vi.stubEnv('CALL_RECAP_LIVE_STATUS_ENABLED', '')
    expect(await refreshDueRecaps({ now: NOW })).toMatchObject({ skipped: 'off', due: 0 })
    expect(db.callRecording.findMany).not.toHaveBeenCalled()
    expect(repostRecap).not.toHaveBeenCalled()
  })

  it('selects due, published recaps inside the age window, oldest first, with a limit', async () => {
    await refreshDueRecaps({ now: NOW, limit: 3 })
    const q = db.callRecording.findMany.mock.calls[0][0] as { where: Record<string, unknown>; take: number; orderBy: unknown }
    expect(q.where).toMatchObject({ recapRefreshAt: { lte: NOW }, status: 'PUBLISHED', publishedAt: { gte: new Date(NOW.getTime() - 60 * 86_400_000) } })
    expect(q.take).toBe(3)
    expect(q.orderBy).toEqual({ recapRefreshAt: 'asc' })
    // Recaps past the window lose their marker.
    expect(db.callRecording.updateMany).toHaveBeenCalledWith({ where: { recapRefreshAt: { not: null }, publishedAt: { lt: new Date(NOW.getTime() - 60 * 86_400_000) } }, data: { recapRefreshAt: null } })
  })

  it('claims the marker, then edits only (ifChanged), never posting', async () => {
    const seen = min(-5)
    db.callRecording.findMany.mockResolvedValue([due({ recapRefreshAt: seen })])
    expect(await refreshDueRecaps({ now: NOW })).toMatchObject({ due: 1, updated: 1 })
    expect(db.callRecording.updateMany).toHaveBeenCalledWith({ where: { id: 'rec1', recapRefreshAt: seen }, data: { recapRefreshAt: null } })
    expect(repostRecap).toHaveBeenCalledTimes(1)
    expect(vi.mocked(repostRecap).mock.calls[0].slice(0, 2)).toEqual(['rec1', { edit: true, ifChanged: true }])
  })

  it('loses the claim race: another run took it, nothing is edited', async () => {
    db.callRecording.findMany.mockResolvedValue([due()])
    db.callRecording.updateMany.mockImplementation(async (a: { where: { id?: string } }) => ({ count: a.where.id ? 0 : 1 }))
    expect(await refreshDueRecaps({ now: NOW })).toMatchObject({ due: 1, updated: 0 })
    expect(repostRecap).not.toHaveBeenCalled()
  })

  it('per-message gap: an edit within the delay of the last one is pushed to last edit + delay', async () => {
    const seen = min(-1)
    db.callRecording.findMany.mockResolvedValue([due({ recapRefreshAt: seen, recapEditedAt: min(-4) })])
    expect(await refreshDueRecaps({ now: NOW })).toMatchObject({ deferred: 1 })
    expect(db.callRecording.updateMany).toHaveBeenCalledWith({ where: { id: 'rec1', recapRefreshAt: seen }, data: { recapRefreshAt: min(6) } })
    expect(repostRecap).not.toHaveBeenCalled()
  })

  it('an unchanged render counts as unchanged', async () => {
    db.callRecording.findMany.mockResolvedValue([due()])
    vi.mocked(repostRecap).mockResolvedValue('unchanged')
    expect(await refreshDueRecaps({ now: NOW })).toMatchObject({ unchanged: 1, updated: 0 })
  })

  it('gone stops for that row: marker cleared, no retry', async () => {
    db.callRecording.findMany.mockResolvedValue([due()])
    vi.mocked(repostRecap).mockResolvedValue('gone')
    expect(await refreshDueRecaps({ now: NOW })).toMatchObject({ gone: 1 })
    expect(db.callRecording.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: { recapRefreshAt: min(60) } }))
  })

  it('a first failure is tried once more in an hour, a repeated one (edit note already there) is not', async () => {
    vi.mocked(repostRecap).mockResolvedValue('failed')
    db.callRecording.findMany.mockResolvedValue([due({ recapError: null })])
    expect(await refreshDueRecaps({ now: NOW })).toMatchObject({ failed: 1 })
    expect(db.callRecording.updateMany).toHaveBeenCalledWith({ where: { id: 'rec1', recapRefreshAt: null }, data: { recapRefreshAt: min(60) } })
    db.callRecording.updateMany.mockClear()
    db.callRecording.findMany.mockResolvedValue([due({ recapError: 'edit failed: boom' })])
    await refreshDueRecaps({ now: NOW })
    expect(db.callRecording.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: { recapRefreshAt: min(60) } }))
  })

  it('a crash in one edit does not stop the next row', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    db.callRecording.findMany.mockResolvedValue([due({ id: 'a' }), due({ id: 'b' })])
    vi.mocked(repostRecap).mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('updated')
    expect(await refreshDueRecaps({ now: NOW })).toMatchObject({ failed: 1, updated: 1 })
  })

  it('other results (disabled, excluded, not-published...) just clear the marker', async () => {
    db.callRecording.findMany.mockResolvedValue([due()])
    for (const r of ['disabled', 'not-published', 'stale-redactions', 'excluded', 'imported', 'no-message'] as const) {
      vi.mocked(repostRecap).mockResolvedValue(r)
      db.callRecording.updateMany.mockClear()
      const out = await refreshDueRecaps({ now: NOW })
      expect(out).toMatchObject({ updated: 0, failed: 0, gone: 0 })
      expect(db.callRecording.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: { recapRefreshAt: min(60) } }))
    }
  })
})
