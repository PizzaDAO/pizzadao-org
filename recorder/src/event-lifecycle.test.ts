import { describe, expect, it } from 'vitest'
import {
  decideEventAction,
  canSwitchTo,
  decideWindowAction,
  eventsInWindow,
  EventStatus,
  isStaleActive,
  pickBootEvent,
  pickWindowEvent,
  type EventInfo,
} from './event-lifecycle.js'

const CHANNEL = '823956905739026442'
const NOW = Date.parse('2026-10-18T18:00:00Z')
const MAX = 120 * 60_000
const o = { callChannelId: CHANNEL, maxCallMs: MAX, nowMs: NOW }

const ev = (over: Partial<EventInfo> = {}): EventInfo => ({
  id: '100',
  name: 'Community Call',
  channelId: CHANNEL,
  status: EventStatus.Active,
  scheduledStartMs: NOW - 60_000,
  ...over,
})

describe('decideEventAction', () => {
  it('starts when an event in the call channel goes ACTIVE and nothing is recording', () => {
    expect(decideEventAction(null, ev(), o)).toEqual({ type: 'start', event: ev() })
  })

  it('ignores ACTIVE events in other channels or with no channel', () => {
    expect(decideEventAction(null, ev({ channelId: '999' }), o)).toEqual({ type: 'ignore' })
    expect(decideEventAction(null, ev({ channelId: null }), o)).toEqual({ type: 'ignore' })
  })

  it('ignores repeated updates of the event already being recorded', () => {
    expect(decideEventAction('100', ev(), o)).toEqual({ type: 'ignore' })
  })

  it('stops when the recorded event completes or is canceled', () => {
    expect(decideEventAction('100', ev({ status: EventStatus.Completed }), o)).toEqual({ type: 'stop', reason: 'event-ended' })
    expect(decideEventAction('100', ev({ status: EventStatus.Canceled }), o)).toEqual({ type: 'stop', reason: 'event-ended' })
  })

  it('ignores the end of an event that is not being recorded', () => {
    expect(decideEventAction('100', ev({ id: '200', status: EventStatus.Completed }), o)).toEqual({ type: 'ignore' })
    expect(decideEventAction(null, ev({ status: EventStatus.Completed }), o)).toEqual({ type: 'ignore' })
  })

  it('closes the current recording and starts the next when a different event goes ACTIVE', () => {
    const next = ev({ id: '200', name: 'Ops' })
    expect(decideEventAction('100', next, o)).toEqual({ type: 'switch', event: next, reason: 'superseded' })
  })

  it('switches only forward, and only once the next slot has started', () => {
    const cur = NOW - 30 * 60_000
    const early = ev({ id: '200', scheduledStartMs: NOW + 15 * 60_000 }) // set ACTIVE 15 min early
    expect(decideEventAction('100', early, o, true, cur)).toEqual({ type: 'ignore' })
    const due = ev({ id: '200', scheduledStartMs: NOW })
    expect(decideEventAction('100', due, o, true, cur).type).toBe('switch')
    const earlier = ev({ id: '300', scheduledStartMs: cur - 1 })
    expect(decideEventAction('100', earlier, o, true, cur)).toEqual({ type: 'ignore' })
    const same = ev({ id: '400', scheduledStartMs: cur })
    expect(decideEventAction('100', same, o, true, cur)).toEqual({ type: 'ignore' })
    expect(decideEventAction('100', ev({ id: '500', scheduledStartMs: null }), o, true, cur)).toEqual({ type: 'ignore' })
  })

  it('ignores SCHEDULED events', () => {
    expect(decideEventAction(null, ev({ status: EventStatus.Scheduled }), o)).toEqual({ type: 'ignore' })
  })

  it('handles the scheduler order "next ACTIVE, then previous COMPLETED" without stopping the new recording', () => {
    const next = ev({ id: '200' })
    expect(decideEventAction('100', next, o).type).toBe('switch')
    expect(decideEventAction('200', ev({ id: '100', status: EventStatus.Completed }), o)).toEqual({ type: 'ignore' })
  })

  it('on boot, skips an ACTIVE event that started longer ago than the max call length', () => {
    const stale = ev({ scheduledStartMs: NOW - MAX - 1 })
    expect(isStaleActive(stale, o)).toBe(true)
    expect(decideEventAction(null, stale, o, false)).toEqual({ type: 'ignore' })
    // a live update is always honored
    expect(decideEventAction(null, stale, o, true).type).toBe('start')
  })
})

describe('pickBootEvent', () => {
  it('picks the most recently started ACTIVE event in the call channel', () => {
    const a = ev({ id: '1', scheduledStartMs: NOW - 50 * 60_000 })
    const b = ev({ id: '2', scheduledStartMs: NOW - 10 * 60_000 })
    expect(pickBootEvent([a, b, ev({ id: '3', channelId: '5' })], o)?.id).toBe('2')
  })

  it('returns null when nothing qualifies', () => {
    expect(pickBootEvent([ev({ status: EventStatus.Scheduled }), ev({ scheduledStartMs: NOW - MAX - 5 })], o)).toBeNull()
    expect(pickBootEvent([], o)).toBeNull()
  })
})

describe('schedule-window trigger', () => {
  const MIN = 60_000
  const T = Date.parse('2026-10-20T18:15:00Z') // Creative Crew scheduled start
  const sched = (id: string, name: string, startMin: number, over: Partial<EventInfo> = {}): EventInfo => ({
    id,
    name,
    channelId: CHANNEL,
    status: EventStatus.Scheduled,
    scheduledStartMs: T + startMin * MIN,
    ...over,
  })
  // 2026-10-20 schedule: Music 17:30, Creative 18:15, Art 18:30, Events 19:00, Merch 19:30, Real Estate 20:00
  const day = [
    sched('music', 'Music Crew', -45),
    sched('creative', 'Creative Crew', 0),
    sched('art', 'Art Crew', 15),
    sched('events', 'Events Crew', 45),
    sched('merch', 'Merch Crew', 75),
    sched('re', 'Real Estate Crew', 105),
  ]
  const at = (min: number, over: Partial<Parameters<typeof decideWindowAction>[0]> = {}) =>
    decideWindowAction({
      callChannelId: CHANNEL,
      maxCallMs: MAX,
      nowMs: T + min * MIN,
      currentEventId: null,
      currentStartMs: null,
      humans: 3,
      events: day,
      ...over,
    })
  const lo = { callChannelId: CHANNEL, maxCallMs: MAX }

  it('starts for a never-ACTIVE (SCHEDULED) event when humans arrive at its start', () => {
    expect(at(0)).toEqual({ type: 'start', event: day[1] })
  })

  it('starts when humans arrive up to 15 minutes before the scheduled start', () => {
    expect(at(-15)).toEqual({ type: 'start', event: day[1] })
    expect(at(-16, { events: [day[1]] })).toEqual({ type: 'ignore' })
  })

  it('does not start without humans (empty channel, bots only)', () => {
    expect(at(0, { humans: 0 })).toEqual({ type: 'ignore' })
  })

  it('does not record people in the channel at random times (no event window)', () => {
    expect(at(-300)).toEqual({ type: 'ignore' })
    expect(at(600)).toEqual({ type: 'ignore' })
  })

  it('ignores events in other channels, completed and canceled events', () => {
    const others = [
      sched('x', 'Other', 0, { channelId: '999' }),
      sched('y', 'Done', 0, { status: EventStatus.Completed }),
      sched('z', 'Canceled', 0, { status: EventStatus.Canceled }),
      sched('n', 'No channel', 0, { channelId: null }),
    ]
    expect(at(0, { events: others })).toEqual({ type: 'ignore' })
  })

  it('ignores an event with no scheduled start', () => {
    expect(at(0, { events: [sched('q', 'Floating', 0, { scheduledStartMs: null })] })).toEqual({ type: 'ignore' })
  })

  it('uses the scheduled end when there is one, else start + max call (window end is exclusive)', () => {
    const e = sched('e', 'Short', 0, { scheduledEndMs: T + 30 * MIN })
    expect(eventsInWindow([e], { ...lo, nowMs: T + 29 * MIN })).toHaveLength(1)
    expect(eventsInWindow([e], { ...lo, nowMs: T + 30 * MIN })).toHaveLength(0)
    const open = sched('o', 'Open', 0)
    expect(eventsInWindow([open], { ...lo, nowMs: T + 119 * MIN })).toHaveLength(1)
    expect(eventsInWindow([open], { ...lo, nowMs: T + 121 * MIN })).toHaveLength(0)
  })

  it('also covers an ACTIVE event in its window', () => {
    const active = sched('creative', 'Creative Crew', 0, { status: EventStatus.Active })
    expect(at(1, { events: [active] })).toEqual({ type: 'start', event: active })
  })

  it('overlapping windows: the event whose scheduled start is closest to now wins', () => {
    expect(pickWindowEvent(day, { ...lo, nowMs: T + 2 * MIN })?.id).toBe('creative')
    expect(pickWindowEvent(day, { ...lo, nowMs: T + 10 * MIN })?.id).toBe('art')
    expect(pickWindowEvent(day, { ...lo, nowMs: T + 7 * MIN })?.id).toBe('creative')
  })

  it('tie-break is deterministic whatever the input order: closest, then earlier start, then id', () => {
    // equidistant (7.5 min each side) -> earlier start
    const a = sched('a', 'A', 0)
    const b = sched('b', 'B', 15)
    const o2 = { ...lo, nowMs: T + 7.5 * MIN }
    expect(pickWindowEvent([a, b], o2)?.id).toBe('a')
    expect(pickWindowEvent([b, a], o2)?.id).toBe('a')
    // two events at the same 18:00 start -> id
    const x = sched('x-2', 'X', 0, { scheduledStartMs: Date.parse('2026-10-21T18:00:00Z') })
    const y = sched('x-1', 'Y', 0, { scheduledStartMs: Date.parse('2026-10-21T18:00:00Z') })
    const o3 = { ...lo, nowMs: Date.parse('2026-10-21T18:02:00Z') }
    expect(pickWindowEvent([x, y], o3)?.id).toBe('x-1')
    expect(pickWindowEvent([y, x], o3)?.id).toBe('x-1')
  })

  it('does not double-start the event already being recorded (it later goes ACTIVE too)', () => {
    expect(at(1, { currentEventId: 'creative', currentStartMs: T })).toEqual({ type: 'ignore' })
    const active = day.map((e) => (e.id === 'creative' ? { ...e, status: EventStatus.Active } : e))
    expect(at(1, { currentEventId: 'creative', currentStartMs: T, events: active })).toEqual({ type: 'ignore' })
  })

  it('back-to-back: keeps the running call until the next slot actually starts, then switches', () => {
    const cur = { currentEventId: 'creative', currentStartMs: T }
    expect(at(10, cur)).toEqual({ type: 'ignore' }) // Art is closer but 5 min away
    expect(at(14, cur)).toEqual({ type: 'ignore' })
    expect(at(15, cur)).toEqual({ type: 'switch', event: day[2], reason: 'superseded' })
  })

  it('never switches backward (an earlier event still in its window while a later one runs)', () => {
    // recording Art (18:30); at 18:40 Creative (18:15) is still in its window but earlier
    const early = day.filter((e) => e.id !== 'art')
    expect(at(25, { currentEventId: 'art', currentStartMs: T + 15 * MIN, events: early })).toEqual({ type: 'ignore' })
    expect(canSwitchTo(day[1], T + 15 * MIN, T + 25 * MIN)).toBe(false)
  })

  it('does not switch (or start) without humans', () => {
    expect(at(16, { currentEventId: 'creative', currentStartMs: T, humans: 0 })).toEqual({ type: 'ignore' })
  })

  it('restart after restart: the bot comes back mid-call and picks the event up again', () => {
    expect(at(25)).toEqual({ type: 'start', event: day[2] })
  })

  it('today (2026-10-20): early ACTIVE on an empty channel, then people at 18:15 -> same session continues', () => {
    const early = { ...o, nowMs: T - 15 * MIN }
    const active = sched('creative', 'Creative Crew', 0, { status: EventStatus.Active })
    expect(decideEventAction(null, active, early)).toEqual({ type: 'start', event: active })
    expect(at(0, { currentEventId: 'creative', currentStartMs: T, events: [active] })).toEqual({ type: 'ignore' })
  })

  it('full 2026-10-20 day, people present 17:25-20:45, events set ACTIVE 15 min early: one session per event, split at each scheduled start', () => {
    const d = (hhmm: string, day = '20') => Date.parse(`2026-10-${day}T${hhmm}:00Z`)
    const starts: Array<[string, string]> = [
      ['music', '17:30'], ['creative', '18:15'], ['art', '18:30'], ['events', '19:00'], ['merch', '19:30'], ['re', '20:00'],
    ]
    const mk = (nowMs: number): EventInfo[] => [
      ...starts.map(([id, hhmm]) => {
        const start = d(hhmm)
        // the scheduler sets each event ACTIVE 15 min early and leaves it ACTIVE
        return sched(id, id, 0, { scheduledStartMs: start, status: nowMs >= start - 15 * MIN ? EventStatus.Active : EventStatus.Scheduled })
      }),
      sched('t1', 'Tomorrow A', 0, { scheduledStartMs: d('18:00', '21') }),
      sched('t2', 'Tomorrow B', 0, { scheduledStartMs: d('18:00', '21') }),
    ]
    let cur: string | null = null
    let curStart: number | null = null
    const sessions: Array<{ id: string; at: number }> = []
    for (let now = d('17:25'); now <= d('20:45'); now += MIN) {
      const events = mk(now)
      const opts = { callChannelId: CHANNEL, maxCallMs: MAX, nowMs: now }
      const apply = (a: ReturnType<typeof decideWindowAction>) => {
        if (a.type === 'start' || a.type === 'switch') {
          cur = a.event.id
          curStart = a.event.scheduledStartMs
          sessions.push({ id: a.event.id, at: now })
        }
      }
      // gateway ACTIVE events first, then the minute timer
      for (const e of events.filter((e) => e.status === EventStatus.Active)) apply(decideEventAction(cur, e, opts, true, curStart))
      apply(decideWindowAction({ ...opts, currentEventId: cur, currentStartMs: curStart, humans: 5, events }))
    }
    expect(sessions.map((s) => s.id)).toEqual(['music', 'creative', 'art', 'events', 'merch', 're'])
    expect(sessions[0].at).toBe(d('17:25')) // first drop-in during the lead window
    for (const [i, [, hhmm]] of starts.entries()) {
      if (i > 0) expect(sessions[i].at).toBe(d(hhmm)) // every later switch lands exactly on the scheduled start
    }
  })
})
