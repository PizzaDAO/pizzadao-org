// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/db')
vi.mock('@/app/lib/settings', () => ({ loadSettings: vi.fn() }))
vi.mock('@/app/lib/call-agenda/run', () => ({ DEFAULT_CALL_VOICE_CHANNEL_ID: '823956905739026442' }))

import { DiscordPostError, type DiscordScheduledEventRaw } from '@/app/lib/discord-rest'
import {
  executeEventTimeSync,
  formatSyncSummary,
  intendedStart,
  planEventTimeChanges,
  proposeRows,
  shiftedRecurrenceRule,
  toSyncEvent,
  type LogRow,
  type SyncDeps,
} from './event-time-sync'
import { wallTimeIn, zonedWallTimeToUtc } from './zoned-time'

const NY = 'America/New_York'
const CH = '823956905739026442'
const iso = (s: string) => Date.parse(s)
const row = (eventId: string, localTime = '14:00', timeZone = NY) => ({ eventId, label: eventId, localTime, timeZone })
const ev = (id: string, start: string, over: Partial<DiscordScheduledEventRaw> = {}): DiscordScheduledEventRaw => ({
  id,
  name: `Crew ${id}`,
  channel_id: CH,
  status: 1,
  scheduled_start_time: start,
  ...over,
})
const plan = (events: DiscordScheduledEventRaw[], rows = events.map((e) => row(e.id)), now = '2026-10-31T12:00:00Z', maxShift = 120) =>
  planEventTimeChanges(events.map((e) => toSyncEvent(e)!), rows, { callChannelId: CH, nowMs: iso(now), maxShiftMinutes: maxShift })

describe('zoned wall time', () => {
  it('maps New York wall times to UTC on both sides of the transitions', () => {
    expect(new Date(zonedWallTimeToUtc(2026, 10, 27, 14, 0, NY)).toISOString()).toBe('2026-10-27T18:00:00.000Z') // EDT
    expect(new Date(zonedWallTimeToUtc(2026, 11, 3, 14, 0, NY)).toISOString()).toBe('2026-11-03T19:00:00.000Z') // EST
    expect(new Date(zonedWallTimeToUtc(2027, 3, 13, 14, 0, NY)).toISOString()).toBe('2027-03-13T19:00:00.000Z') // EST
    expect(new Date(zonedWallTimeToUtc(2027, 3, 16, 14, 0, NY)).toISOString()).toBe('2027-03-16T18:00:00.000Z') // EDT
  })
  it('handles the transition days themselves', () => {
    // Nov 1 2026: 12:00 is already EST. Mar 14 2027: 12:00 is already EDT.
    expect(new Date(zonedWallTimeToUtc(2026, 11, 1, 12, 0, NY)).toISOString()).toBe('2026-11-01T17:00:00.000Z')
    expect(new Date(zonedWallTimeToUtc(2027, 3, 14, 12, 0, NY)).toISOString()).toBe('2027-03-14T16:00:00.000Z')
  })
  it('reads wall time back', () => {
    expect(wallTimeIn(iso('2026-11-03T19:00:00Z'), NY)).toMatchObject({ day: 3, hour: 14, minute: 0 })
    expect(wallTimeIn(iso('2026-11-04T00:30:00Z'), NY)).toMatchObject({ day: 3, hour: 19, minute: 30 })
  })
})

describe('planning', () => {
  it('moves an event that drifted an hour after the November change', () => {
    const [p] = plan([ev('1', '2026-11-03T18:00:00Z')])
    expect(p).toMatchObject({ action: 'patch', newStartMs: iso('2026-11-03T19:00:00Z') })
    expect(p.body).toEqual({ scheduled_start_time: '2026-11-03T19:00:00.000Z' })
  })
  it('moves it back an hour in March', () => {
    const [p] = plan([ev('1', '2027-03-16T19:00:00Z')], undefined, '2027-03-10T12:00:00Z')
    expect(p).toMatchObject({ action: 'patch', newStartMs: iso('2027-03-16T18:00:00Z') })
  })
  it('does nothing for an event already on its local time (hand-fixed events report no drift)', () => {
    expect(plan([ev('1', '2026-11-03T19:00:00Z'), ev('2', '2026-10-27T18:00:00Z')])).toEqual([])
  })
  it('catches the occurrence that crosses the change: next start still EDT, intended EST', () => {
    // Series is 18:00Z (14:00 EDT); the occurrence on Nov 3 is after the change, so it should be 19:00Z.
    expect(plan([ev('1', '2026-11-03T18:00:00Z')])).toHaveLength(1)
    // The occurrence before the change is fine.
    expect(plan([ev('1', '2026-10-27T18:00:00Z')])).toEqual([])
  })
  it('keeps the weekday when the shift crosses local midnight (picks the closest candidate day)', () => {
    const r = row('1', '23:30')
    // 23:30 EDT = 03:30Z next day; after the change that is 22:30 EST (Mon 02 Nov -> Tue 03:30Z is Mon 22:30 EST).
    expect(new Date(intendedStart(iso('2026-11-03T03:30:00Z'), r)!).toISOString()).toBe('2026-11-03T04:30:00.000Z')
  })
  it('skips events outside the call channel, without a row, completed or canceled', () => {
    const events = [ev('1', '2026-11-03T18:00:00Z', { channel_id: '1' }), ev('2', '2026-11-03T18:00:00Z'), ev('3', '2026-11-03T18:00:00Z', { status: 3 }), ev('4', '2026-11-03T18:00:00Z', { status: 4 })]
    expect(plan(events, [row('1'), row('3'), row('4')])).toEqual([])
  })
  it('never patches a running event: skipped_active', () => {
    expect(plan([ev('1', '2026-11-03T18:00:00Z', { status: 2 })])[0]).toMatchObject({ action: 'skipped_active' })
  })
  it('refuses shifts over the limit', () => {
    const [p] = plan([ev('1', '2026-11-03T22:00:00Z')]) // 17:00 EST vs 14:00 intended: 3 h (candidate day is the same)
    expect(p).toMatchObject({ action: 'skipped_guard' })
    expect(p.reason).toMatch(/180 min/)
  })
  it('the limit is configurable', () => {
    expect(plan([ev('1', '2026-11-03T18:00:00Z')], undefined, undefined, 30)[0]).toMatchObject({ action: 'skipped_guard' })
  })
  it('leaves an occurrence about to start alone', () => {
    expect(plan([ev('1', '2026-11-03T18:00:00Z')], undefined, '2026-11-03T17:50:00Z')[0]).toMatchObject({ action: 'skipped_guard' })
    expect(plan([ev('1', '2026-11-03T18:00:00Z')], undefined, '2026-11-03T19:30:00Z')[0]).toMatchObject({ action: 'skipped_guard' })
  })
  it('shifts the end time by the same amount', () => {
    const [p] = plan([ev('1', '2026-11-03T18:00:00Z', { scheduled_end_time: '2026-11-03T19:00:00Z' })])
    expect(p.body).toMatchObject({ scheduled_end_time: '2026-11-03T20:00:00.000Z' })
  })
})

describe('recurrence rule', () => {
  const weekly = { start: '2026-10-27T18:00:00+00:00', end: null, frequency: 2, interval: 1, by_weekday: [1], by_n_weekday: null, by_month: null, by_month_day: null, by_year_day: null, count: null }
  it('moves start, keeps frequency and interval, drops read-only fields', () => {
    const r = shiftedRecurrenceRule(weekly, iso('2026-11-03T18:00:00Z'), iso('2026-11-03T19:00:00Z'))
    expect(r).toEqual({ start: '2026-11-03T19:00:00.000Z', frequency: 2, interval: 1, by_weekday: [1] })
  })
  it('moves the weekday when the shift crosses UTC midnight', () => {
    expect(shiftedRecurrenceRule(weekly, iso('2026-11-03T23:30:00Z'), iso('2026-11-04T00:30:00Z')).by_weekday).toEqual([2])
    expect(shiftedRecurrenceRule({ ...weekly, by_weekday: [0] }, iso('2026-11-02T00:30:00Z'), iso('2026-11-01T23:30:00Z')).by_weekday).toEqual([6])
  })
  it('moves by_month_day with a UTC date change', () => {
    const monthly = { ...weekly, frequency: 3, by_weekday: null, by_month_day: [3, -1] }
    expect(shiftedRecurrenceRule(monthly, iso('2026-11-03T23:30:00Z'), iso('2026-11-04T00:30:00Z')).by_month_day).toEqual([4, -1])
    expect(shiftedRecurrenceRule(monthly, iso('2026-11-03T18:00:00Z'), iso('2026-11-03T19:00:00Z')).by_month_day).toEqual([3, -1])
  })
  it('is sent with the patch', () => {
    const [p] = plan([ev('1', '2026-11-03T18:00:00Z', { recurrence_rule: weekly })])
    expect(p.body?.recurrence_rule).toMatchObject({ start: '2026-11-03T19:00:00.000Z', frequency: 2 })
  })
})

function makeDeps(events: DiscordScheduledEventRaw[], over: Partial<SyncDeps> = {}) {
  const logged: LogRow[] = []
  const patch = vi.fn(async (id: string, body: Record<string, unknown>) => ({ id, scheduled_start_time: body.scheduled_start_time as string }) as DiscordScheduledEventRaw)
  const deps: SyncDeps = {
    listEvents: async () => events,
    getEvent: async (id) => events.find((e) => e.id === id)!,
    patchEvent: patch,
    alreadyLogged: async (r) => logged.some((l) => l.eventId === r.eventId && l.action === r.action && +l.oldStart === +r.oldStart),
    logRow: async (r) => {
      logged.push(r)
    },
    sleep: async () => undefined,
    ...over,
  }
  return { deps, logged, patch }
}
const base = { callChannelId: CH, nowMs: iso('2026-10-31T12:00:00Z'), maxShiftMinutes: 120 }

describe('executeEventTimeSync', () => {
  const events = [ev('1', '2026-11-03T18:00:00Z'), ev('2', '2026-11-03T19:00:00Z'), ev('3', '2026-11-04T18:00:00Z')]
  const rows = [row('1'), row('2'), row('3')]

  it('dry run logs what it would do and never patches', async () => {
    const { deps, logged, patch } = makeDeps(events)
    const r = await executeEventTimeSync({ ...base, rows, dryRun: true }, deps)
    expect(patch).not.toHaveBeenCalled()
    expect(r).toMatchObject({ checked: 3, wouldPatch: 2, patched: 0 })
    expect(logged.map((l) => l.action)).toEqual(['dry_run', 'dry_run'])
  })

  it('a clean run (hand-fixed events) reports zero drift and logs nothing', async () => {
    const fixed = [ev('1', '2026-11-03T19:00:00Z'), ev('2', '2026-11-03T19:00:00Z')]
    const { deps, logged } = makeDeps(fixed)
    const r = await executeEventTimeSync({ ...base, rows: [row('1'), row('2')], dryRun: true }, deps)
    expect(r).toMatchObject({ checked: 2, wouldPatch: 0, patched: 0, skipped: 0, failed: 0 })
    expect(logged).toEqual([])
    expect(formatSyncSummary(r)).toBeNull()
  })

  it('patches with an audit reason and logs the returned start', async () => {
    const { deps, logged, patch } = makeDeps(events)
    const r = await executeEventTimeSync({ ...base, rows, dryRun: false }, deps)
    expect(r.patched).toBe(2)
    expect(patch).toHaveBeenCalledWith('1', { scheduled_start_time: '2026-11-03T19:00:00.000Z' }, 'DST sync: 14:00 America/New_York')
    expect(logged.every((l) => l.action === 'patched' && l.newStart)).toBe(true)
    expect(formatSyncSummary(r)).toMatch(/Crew 1: moved/)
  })

  it('logs the recurrence rule Discord returned after the patch', async () => {
    const rule = { start: '2026-11-03T19:00:00+00:00', frequency: 2, interval: 1, by_weekday: [1] }
    const { deps, logged } = makeDeps([ev('1', '2026-11-03T18:00:00Z', { recurrence_rule: rule })], {
      patchEvent: async (id, body) => ({ id, scheduled_start_time: body.scheduled_start_time as string, recurrence_rule: rule }),
    })
    await executeEventTimeSync({ ...base, rows: [row('1')], dryRun: false }, deps)
    expect(logged[0].action).toBe('patched')
    expect(logged[0].error).toContain('recurrence_rule after:')
    expect(logged[0].error).toContain('by_weekday')
  })

  it('logs a skipped outcome once, not on every run', async () => {
    const running = [ev('1', '2026-11-03T18:00:00Z', { status: 2 })]
    const { deps, logged } = makeDeps(running)
    const o = { ...base, rows: [row('1')], dryRun: false }
    expect((await executeEventTimeSync(o, deps)).skipped).toBe(1)
    const second = await executeEventTimeSync(o, deps)
    expect(second.skipped).toBe(1)
    expect(logged).toHaveLength(1)
    expect(formatSyncSummary(second)).toBeNull()
  })

  it('re-reads before writing: an event that started meanwhile is skipped, not patched', async () => {
    const { deps, patch, logged } = makeDeps(events, { getEvent: async (id) => ({ ...events.find((e) => e.id === id)!, status: 2 }) })
    const r = await executeEventTimeSync({ ...base, rows, dryRun: false }, deps)
    expect(patch).not.toHaveBeenCalled()
    expect(logged.map((l) => l.action)).toEqual(['skipped_active', 'skipped_active'])
    expect(r.patched).toBe(0)
  })

  it('a 429 stops the run and the rest are logged failed (retried next run)', async () => {
    const patch = vi.fn(async () => {
      throw new DiscordPostError('rate limited', 429, 20_000)
    })
    const { deps, logged } = makeDeps(events, { patchEvent: patch })
    const r = await executeEventTimeSync({ ...base, rows, dryRun: false }, deps)
    expect(patch).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({ stoppedEarly: true, failed: 2, patched: 0 })
    expect(logged.map((l) => l.action)).toEqual(['failed', 'failed'])
  })

  it('another error fails that event and carries on', async () => {
    let n = 0
    const patch = vi.fn(async (id: string, body: Record<string, unknown>) => {
      if (n++ === 0) throw new DiscordPostError('boom', 400)
      return { id, scheduled_start_time: body.scheduled_start_time as string }
    })
    const { deps } = makeDeps(events, { patchEvent: patch })
    const r = await executeEventTimeSync({ ...base, rows, dryRun: false }, deps)
    expect(r).toMatchObject({ failed: 1, patched: 1, stoppedEarly: false })
  })

  it('Discord answering with another start is a failure', async () => {
    const { deps } = makeDeps(events, { patchEvent: async (id) => ({ id, scheduled_start_time: '2026-11-03T18:00:00Z' }) })
    const r = await executeEventTimeSync({ ...base, rows: [row('1')], dryRun: false }, deps)
    expect(r.failed).toBe(1)
  })

  it('caps patches per run', async () => {
    const { deps, patch } = makeDeps(events)
    const r = await executeEventTimeSync({ ...base, rows, dryRun: false, maxPatches: 1 }, deps)
    expect(patch).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({ patched: 1, skipped: 1 })
  })
})

describe('proposeRows (Fill from Discord)', () => {
  const rule = { frequency: 2, interval: 1, by_weekday: [1] }
  it('adds recurring call-channel events with their current local time and keeps existing rows', () => {
    const events = [
      ev('100000000000000001', '2026-11-03T19:00:00Z', { recurrence_rule: rule, name: 'Ops call' }),
      ev('100000000000000002', '2026-11-04T23:30:00Z', { recurrence_rule: rule, name: 'Art call' }),
      ev('100000000000000003', '2026-11-04T23:30:00Z', { name: 'one-off, no rule' }),
      ev('100000000000000004', '2026-11-04T23:30:00Z', { recurrence_rule: rule, channel_id: '1' }),
      ev('100000000000000005', '2026-11-04T23:30:00Z', { recurrence_rule: rule, status: 3 }),
    ].map((e) => toSyncEvent(e)!)
    const existing = [row('100000000000000002', '10:00')]
    const out = proposeRows(events, existing, { callChannelId: CH, timeZone: NY })
    expect(out).toEqual([
      { eventId: '100000000000000002', label: '100000000000000002', localTime: '10:00', timeZone: NY },
      { eventId: '100000000000000001', label: 'Ops call', localTime: '14:00', timeZone: NY },
    ])
  })
  it('a freshly filled table shows zero drift for the same events', () => {
    const raws = [ev('1', '2026-11-03T19:00:00Z', { recurrence_rule: rule }), ev('2', '2026-11-05T00:30:00Z', { recurrence_rule: rule })]
    const events = raws.map((e) => toSyncEvent(e)!)
    const rows = proposeRows(events, [], { callChannelId: CH, timeZone: NY })
    expect(planEventTimeChanges(events, rows, { callChannelId: CH, nowMs: iso('2026-11-02T12:00:00Z'), maxShiftMinutes: 120 })).toEqual([])
  })
})

describe('runEventTimeSync: previews never patch', () => {
  it('forces a dry run unless VERCEL_ENV is production', async () => {
    const { loadSettings } = await import('@/app/lib/settings')
    const { SETTINGS } = await import('@/app/lib/settings/registry')
    vi.mocked(loadSettings).mockResolvedValue({
      readFailed: false,
      invalidKeys: [],
      isSet: () => true,
      get: ((k: string) => (k === 'calls.eventLocalTimes' ? [row('1')] : (SETTINGS as Record<string, { default: unknown }>)[k].default)) as never,
    })
    const { runEventTimeSync } = await import('./event-time-sync')
    const events = [ev('1', '2026-11-03T18:00:00Z')]
    const env = { DISCORD_BOT_TOKEN: 't', DISCORD_GUILD_ID: '123456', CALL_VOICE_CHANNEL_ID: CH }
    const now = new Date('2026-10-31T12:00:00Z')
    for (const [vercel, expectPatch] of [['preview', false], [undefined, false], ['production', true]] as const) {
      const { deps, patch } = makeDeps(events)
      const r = await runEventTimeSync({ dryRun: false, now, env: { ...env, VERCEL_ENV: vercel } as unknown as NodeJS.ProcessEnv, deps })
      expect('notRun' in r).toBe(false)
      expect(patch.mock.calls.length > 0).toBe(expectPatch)
    }
  })
})
