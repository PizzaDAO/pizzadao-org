// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const cfg = vi.hoisted(() => ({ enabled: true }))
vi.mock('./config', () => ({ loadEventsAttendedConfig: vi.fn(async () => ({ enabled: cfg.enabled, rsvRecheckDays: 7 })) }))
const rsv = vi.hoisted(() => ({ listDueMembers: vi.fn(), refreshRsvEvents: vi.fn() }))
vi.mock('./rsv', () => rsv)

import { runRsvEventsRefresh } from './cron'

const sleep = async () => undefined
beforeEach(() => {
  vi.clearAllMocks()
  cfg.enabled = true
  rsv.refreshRsvEvents.mockResolvedValue({ ok: true, count: 1 })
})

describe('runRsvEventsRefresh', () => {
  it('does nothing while the feature is off', async () => {
    cfg.enabled = false
    expect(await runRsvEventsRefresh({ sleep })).toMatchObject({ enabled: false, checked: 0 })
    expect(rsv.listDueMembers).not.toHaveBeenCalled()
  })

  it('checks the due members in order, counting failures, with the configured staleness and batch', async () => {
    rsv.listDueMembers.mockResolvedValue(['a', 'b', 'c'])
    rsv.refreshRsvEvents.mockResolvedValueOnce({ ok: true, count: 1 }).mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, count: 0 })
    const r = await runRsvEventsRefresh({ sleep, batch: 50 })
    expect(rsv.listDueMembers).toHaveBeenCalledWith(7, 50)
    expect(r).toEqual({ enabled: true, due: 3, checked: 2, failed: 1, timedOut: false })
  })

  it('stops when the time budget is spent and leaves the rest for the next run', async () => {
    rsv.listDueMembers.mockResolvedValue(['a', 'b', 'c'])
    let t = 0
    const r = await runRsvEventsRefresh({ sleep, budgetMs: 1000, now: () => (t += 600) })
    expect(r.timedOut).toBe(true)
    expect(r.checked + r.failed).toBeLessThan(3)
  })

  it('counts a throwing refresh as a failure and keeps going', async () => {
    rsv.listDueMembers.mockResolvedValue(['a', 'b'])
    rsv.refreshRsvEvents.mockRejectedValueOnce(new Error('x'))
    const r = await runRsvEventsRefresh({ sleep })
    expect(r).toMatchObject({ checked: 1, failed: 1 })
  })
})
