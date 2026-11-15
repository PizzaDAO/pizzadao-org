import { describe, expect, it } from 'vitest'
import { AfterRecordingTracker, liveContinuesAfter, occurrenceLive, occurrenceState } from './after-recording.js'
import { EventStatus, type EventInfo } from './event-lifecycle.js'

describe('liveContinuesAfter', () => {
  it('keeps the live view after the recording limit or a lost connection only', () => {
    expect(liveContinuesAfter('max-duration')).toBe(true)
    expect(liveContinuesAfter('disconnected')).toBe(true)
    for (const r of ['event-ended', 'empty', 'superseded', 'shutdown', 'channel-disallowed'] as const) expect(liveContinuesAfter(r)).toBe(false)
  })
})

describe('AfterRecordingTracker', () => {
  const t0 = 1_000_000
  const make = () => new AfterRecordingTracker(t0, { emptyGraceMs: 120_000, capMs: 4 * 3_600_000 })

  it('stays up while people are here', () => {
    const t = make()
    t.observeHumans(3, t0 + 60_000)
    expect(t.check(t0 + 3 * 3_600_000)).toBeNull()
  })

  it('ends once the channel has been empty for the grace; a return resets it', () => {
    const t = make()
    t.observeHumans(0, t0 + 10_000)
    expect(t.check(t0 + 129_999)).toBeNull()
    t.observeHumans(1, t0 + 100_000)
    expect(t.check(t0 + 200_000)).toBeNull()
    t.observeHumans(0, t0 + 200_000)
    t.observeHumans(0, t0 + 250_000) // still empty: the clock keeps the first empty moment
    expect(t.check(t0 + 319_999)).toBeNull()
    expect(t.check(t0 + 320_000)).toBe('empty')
  })

  it('ends at the cap since the recording started, even with people here', () => {
    const t = make()
    t.observeHumans(5, t0)
    expect(t.check(t0 + 4 * 3_600_000 - 1)).toBeNull()
    expect(t.check(t0 + 4 * 3_600_000)).toBe('cap')
  })
})

describe('occurrenceLive', () => {
  const e = (over: Partial<EventInfo> = {}): EventInfo => ({ id: '1', name: 'Call', channelId: '2', status: EventStatus.Active, scheduledStartMs: 500, ...over })
  it('is live while the same occurrence is scheduled or active', () => {
    expect(occurrenceLive([e()], '1', 500)).toBe(true)
    expect(occurrenceLive([e({ status: EventStatus.Scheduled })], '1', 500)).toBe(true)
    expect(occurrenceLive([e({ scheduledStartMs: 999 })], '1', null)).toBe(true)
  })
  it('is not once completed, canceled, rolled on to the next occurrence or gone', () => {
    expect(occurrenceLive([e({ status: EventStatus.Completed })], '1', 500)).toBe(false)
    expect(occurrenceLive([e({ status: EventStatus.Canceled })], '1', 500)).toBe(false)
    expect(occurrenceLive([e({ status: EventStatus.Scheduled, scheduledStartMs: 500 + 7 * 86_400_000 })], '1', 500)).toBe(false)
    expect(occurrenceLive([], '1', 500)).toBe(false)
    expect(occurrenceLive([e()], null, 500)).toBe(false)
  })
})

describe('occurrenceState', () => {
  const e = (over: Partial<EventInfo> = {}): EventInfo => ({ id: '1', name: 'Call', channelId: '2', status: EventStatus.Active, scheduledStartMs: 500, ...over })
  const DAY = 86_400_000
  it('completed and rolled on are a real end; canceled and deleted are not', () => {
    expect(occurrenceState([e({ status: EventStatus.Completed })], '1', 500)).toBe('completed')
    expect(occurrenceState([e({ status: EventStatus.Scheduled, scheduledStartMs: 500 + 7 * DAY })], '1', 500)).toBe('rolled')
    expect(occurrenceState([e({ status: EventStatus.Scheduled, scheduledStartMs: 500 + 7 * DAY, recurrenceIntervalMs: 7 * DAY })], '1', 500)).toBe('rolled')
    expect(occurrenceState([e({ status: EventStatus.Canceled })], '1', 500)).toBe('canceled')
    expect(occurrenceState([e({ id: '9' })], '1', 500)).toBe('gone')
  })
  it('an edited start time is still the same occurrence', () => {
    expect(occurrenceState([e({ scheduledStartMs: 500 + 30 * 60_000 })], '1', 500)).toBe('live')
    expect(occurrenceState([e({ status: EventStatus.Active, scheduledStartMs: 500 + 2 * DAY })], '1', 500)).toBe('live')
    expect(occurrenceState([e({ status: EventStatus.Scheduled, scheduledStartMs: 500 + 3 * 3_600_000 })], '1', 500)).toBe('live')
    expect(occurrenceState([e({ status: EventStatus.Scheduled, scheduledStartMs: 500 + 2 * DAY, recurrenceIntervalMs: 7 * DAY })], '1', 500)).toBe('live')
    expect(occurrenceState([e({ status: EventStatus.Scheduled, scheduledStartMs: 500 - 3_600_000 })], '1', 500)).toBe('live')
  })
})
