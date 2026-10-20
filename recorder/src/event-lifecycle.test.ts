import { describe, expect, it } from 'vitest'
import {
  decideEventAction,
  decideWindowAction,
  eventsInWindow,
  EventStatus,
  isStaleActive,
  pickBootEvent,
  pickWindowEvent,
  type EventInfo,
  type FinishedInfo,
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
  const none = new Map<string, FinishedInfo>()
  const at = (min: number, over: Partial<Parameters<typeof decideWindowAction>[0]> = {}) =>
    decideWindowAction({
      callChannelId: CHANNEL,
      maxCallMs: MAX,
      nowMs: T + min * MIN,
      currentEventId: null,
      humans: 3,
      events: day,
      finished: none,
      ...over,
    })

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
    expect(at(-300)).toEqual({ type: 'ignore' }) // 13:15, hours before anything
    expect(at(600)).toEqual({ type: 'ignore' }) // after every window
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

  it('uses the scheduled end when there is one, else start + max call', () => {
    const e = sched('e', 'Short', 0, { scheduledEndMs: T + 30 * MIN })
    expect(eventsInWindow([e], { callChannelId: CHANNEL, maxCallMs: MAX, nowMs: T + 29 * MIN })).toHaveLength(1)
    expect(eventsInWindow([e], { callChannelId: CHANNEL, maxCallMs: MAX, nowMs: T + 31 * MIN })).toHaveLength(0)
    const open = sched('o', 'Open', 0)
    expect(eventsInWindow([open], { callChannelId: CHANNEL, maxCallMs: MAX, nowMs: T + 119 * MIN })).toHaveLength(1)
    expect(eventsInWindow([open], { callChannelId: CHANNEL, maxCallMs: MAX, nowMs: T + 121 * MIN })).toHaveLength(0)
  })

  it('also covers an ACTIVE event in its window', () => {
    const active = sched('creative', 'Creative Crew', 0, { status: EventStatus.Active })
    expect(at(1, { events: [active] })).toEqual({ type: 'start', event: active })
  })

  it('overlapping windows: the event whose scheduled start is closest to now wins', () => {
    const o = { callChannelId: CHANNEL, maxCallMs: MAX }
    expect(pickWindowEvent(day, { ...o, nowMs: T + 2 * MIN })?.id).toBe('creative') // Music (ends 19:30) also covers
    expect(pickWindowEvent(day, { ...o, nowMs: T + 10 * MIN })?.id).toBe('art') // 5 min to Art vs 10 since Creative
    expect(pickWindowEvent(day, { ...o, nowMs: T + 7 * MIN })?.id).toBe('creative')
  })

  it('does not double-start the event already being recorded (it later goes ACTIVE too)', () => {
    expect(at(1, { currentEventId: 'creative' })).toEqual({ type: 'ignore' })
    const active = day.map((e) => (e.id === 'creative' ? { ...e, status: EventStatus.Active } : e))
    expect(at(1, { currentEventId: 'creative', events: active })).toEqual({ type: 'ignore' })
  })

  it('back-to-back: keeps the running call until the next event is about to start, then switches', () => {
    expect(at(8, { currentEventId: 'creative' })).toEqual({ type: 'ignore' }) // Art is 7 min away
    expect(at(10, { currentEventId: 'creative' })).toEqual({ type: 'switch', event: day[2], reason: 'superseded' })
    expect(at(16, { currentEventId: 'creative' })).toEqual({ type: 'switch', event: day[2], reason: 'superseded' })
  })

  it('does not switch (or start) without humans', () => {
    expect(at(12, { currentEventId: 'creative', humans: 0 })).toEqual({ type: 'ignore' })
  })

  it('restart after restart: the bot comes back mid-call and picks the event up again', () => {
    // nothing recorded, nothing finished, people in the channel at 18:40: Art Crew (start 18:30)
    expect(at(25)).toEqual({ type: 'start', event: day[2] })
  })

  it('an event that ended after capturing audio is not restarted', () => {
    const finished = new Map([['creative', { capturedAudio: true }]])
    expect(at(30, { finished, events: [day[1]] })).toEqual({ type: 'ignore' })
  })

  it('an event that ended capturing NO audio may restart when humans return in its window', () => {
    const finished = new Map([['creative', { capturedAudio: false }]])
    expect(at(30, { finished, events: [day[1]] })).toEqual({ type: 'start', event: day[1] })
  })

  it('today (2026-10-20): early ACTIVE on an empty channel, nobody until 18:15 -> the ACTIVE path starts it, window path then ignores it', () => {
    const early = { ...o, nowMs: T - 15 * MIN }
    const active = sched('creative', 'Creative Crew', 0, { status: EventStatus.Active })
    expect(decideEventAction(null, active, early)).toEqual({ type: 'start', event: active })
    // people arrive at 18:15 while that session is still recording
    expect(at(0, { currentEventId: 'creative', events: [active] })).toEqual({ type: 'ignore' })
  })

  it('today: the five never-ACTIVE crews each start when people arrive in their slot', () => {
    for (const [i, id] of [[-45, 'music'], [15, 'art'], [45, 'events'], [75, 'merch'], [105, 're']] as const) {
      const a = at(i + 1, { events: day.filter((e) => Math.abs((e.scheduledStartMs as number) - (T + i * MIN)) < 1 || e.id === 'x') })
      expect(a).toMatchObject({ type: 'start', event: { id } })
    }
  })
})
