import { describe, expect, it } from 'vitest'
import {
  canSwitchTo,
  decideWindowAction,
  eventKey,
  eventsInWindow,
  EventStatus,
  isFailureStop,
  MAX_ATTEMPTS,
  pickWindowEvent,
  RETRY_BACKOFF_MS,
  StartBackoff,
  type EventInfo,
} from './event-lifecycle.js'

const CHANNEL = '823956905739026442'
const MAX = 120 * 60_000
const MIN = 60_000
const lo = { callChannelId: CHANNEL, maxCallMs: MAX }
const d = (hhmm: string, day = '20') => Date.parse(`2026-10-${day}T${hhmm}:00Z`)

const sched = (id: string, hhmm: string, over: Partial<EventInfo> = {}, day = '20'): EventInfo => ({
  id,
  name: id,
  channelId: CHANNEL,
  status: EventStatus.Scheduled,
  scheduledStartMs: d(hhmm, day),
  ...over,
})

// 2026-10-20 schedule
const day = () => [
  sched('music', '17:30'),
  sched('creative', '18:15'),
  sched('art', '18:30'),
  sched('events', '19:00'),
  sched('merch', '19:30'),
  sched('re', '20:00'),
]

const at = (hhmm: string, over: Partial<Parameters<typeof decideWindowAction>[0]> = {}) =>
  decideWindowAction({
    ...lo,
    nowMs: d(hhmm),
    currentEventId: null,
    currentStartMs: null,
    humans: 3,
    events: day(),
    ...over,
  })

describe('COMPLETED / CANCELED', () => {
  it('keep an idle bot from starting a recording', () => {
    const done = [sched('c', '18:15', { status: EventStatus.Completed }), sched('x', '18:15', { status: EventStatus.Canceled })]
    expect(at('18:16', { events: done })).toEqual({ type: 'ignore' })
  })

  it('do not disturb a running session; the next slot still takes over at its start, an un-begun one never does', () => {
    const events = day().map((e) => (e.id === 'creative' ? { ...e, status: EventStatus.Completed } : e))
    const cur = { currentEventId: 'creative', currentStartMs: d('18:15'), events }
    expect(at('18:15', cur)).toEqual({ type: 'ignore' })
    expect(at('18:29', cur)).toEqual({ type: 'ignore' })
    expect(at('18:30', cur)).toMatchObject({ type: 'switch', event: { id: 'art' } })
    // provisional current (slot not begun) whose event got CANCELED: still only begun slots can take over
    const prov = { currentEventId: 'creative', currentStartMs: d('18:15'), events: day().filter((e) => e.id !== 'music') }
    expect(at('18:05', prov)).toEqual({ type: 'ignore' })
  })
})

describe('late manual start / restart mid-call (ACTIVE past its scheduled start)', () => {
  const act = (id: string, hhmm: string) => sched(id, hhmm, { status: EventStatus.Active })
  it('host presses Start at 19:50 for an 18:15 event with people present -> records', () => {
    expect(at('19:50', { events: [act('creative', '18:15')] })).toMatchObject({ type: 'start', event: { id: 'creative' } })
    // the same event merely SCHEDULED is past its window
    expect(at('19:50', { events: [sched('creative', '18:15')] })).toEqual({ type: 'ignore' })
  })

  it('a restart 100 min into an ACTIVE call resumes it, but not after MAX_CALL_MINUTES', () => {
    expect(at('19:55', { events: [act('creative', '18:15')] })).toMatchObject({ type: 'start' })
    expect(at('20:16', { events: [act('creative', '18:15')] })).toEqual({ type: 'ignore' })
  })

  it('ACTIVE before its scheduled start is still ignored outside the lead window', () => {
    expect(at('17:00', { events: [act('re', '20:00')] })).toEqual({ type: 'ignore' })
  })
})

describe('schedule window', () => {
  it('starts for a SCHEDULED event when humans arrive at its start, and up to 15 min before', () => {
    expect(at('18:15')).toMatchObject({ type: 'start', event: { id: 'creative' } })
    expect(at('18:00', { events: [day()[1]] })).toMatchObject({ type: 'start', event: { id: 'creative' } })
    expect(at('17:59', { events: [day()[1]] })).toEqual({ type: 'ignore' })
  })

  it('does not start without humans, nor with no window', () => {
    expect(at('18:15', { humans: 0 })).toEqual({ type: 'ignore' })
    expect(at('13:15')).toEqual({ type: 'ignore' })
  })

  it('ignores other channels, completed, canceled, channel-less and start-less events', () => {
    const others = [
      sched('x', '18:15', { channelId: '999' }),
      sched('y', '18:15', { status: EventStatus.Completed }),
      sched('z', '18:15', { status: EventStatus.Canceled }),
      sched('n', '18:15', { channelId: null }),
      sched('q', '18:15', { scheduledStartMs: null }),
    ]
    expect(at('18:15', { events: others })).toEqual({ type: 'ignore' })
  })

  it('an ACTIVE event is eligible in its window like a SCHEDULED one', () => {
    const e = sched('creative', '18:15', { status: EventStatus.Active })
    expect(at('18:16', { events: [e] })).toMatchObject({ type: 'start', event: { id: 'creative' } })
  })

  it('uses the scheduled end when there is one (exclusive)', () => {
    const e = sched('e', '18:15', { scheduledEndMs: d('18:45') })
    expect(eventsInWindow([e], { ...lo, nowMs: d('18:44') })).toHaveLength(1)
    expect(eventsInWindow([e], { ...lo, nowMs: d('18:45') })).toHaveLength(0)
  })

  it('no scheduled end: the start window closes at the next event start or start + 90 min', () => {
    const music = day()[0]
    expect(eventsInWindow(day(), { ...lo, nowMs: d('18:14') }).map((e) => e.id)).toContain('music')
    // Music's window ends when Creative starts
    const ids = (hhmm: string) => eventsInWindow(day(), { ...lo, nowMs: d(hhmm) }).map((e) => e.id)
    expect(ids('18:15')).not.toContain('music')
    expect(music.id).toBe('music')
    // Real Estate: nothing after it that day (10-21 events are far), so 20:00 + 90 min
    expect(ids('21:29')).toContain('re')
    expect(ids('21:30')).not.toContain('re')
  })

  it('tie-break is deterministic whatever the input order: closest, then earlier start, then id', () => {
    const a = sched('a', '18:00')
    const b = sched('b', '18:15')
    const o = { ...lo, nowMs: d('18:07') + 30_000 }
    expect(pickWindowEvent([a, b], o)?.id).toBe('a')
    expect(pickWindowEvent([b, a], o)?.id).toBe('a')
    const x = sched('x-2', '18:00', {}, '21')
    const y = sched('x-1', '18:00', {}, '21')
    const o3 = { ...lo, nowMs: d('18:02', '21') }
    expect(pickWindowEvent([x, y], o3)?.id).toBe('x-1')
    expect(pickWindowEvent([y, x], o3)?.id).toBe('x-1')
  })
})

describe('idle pick prefers the slot that has begun', () => {
  it('18:12 idle: Music (begun) over Creative (closer but upcoming); only upcoming -> closest', () => {
    expect(at('18:12')).toMatchObject({ type: 'start', event: { id: 'music' } })
    expect(at('17:20')).toMatchObject({ type: 'start', event: { id: 'music' } })
    expect(at('18:25')).toMatchObject({ type: 'start', event: { id: 'creative' } })
    expect(at('18:00', { events: [day()[1], day()[2]] })).toMatchObject({ type: 'start', event: { id: 'creative' } })
  })
})

describe('switching', () => {
  const creative = { currentEventId: 'creative', currentStartMs: d('18:15') }

  it('does nothing for the event already being recorded', () => {
    expect(at('18:20', creative)).toEqual({ type: 'ignore' })
  })

  it('keeps the running call until the next slot starts, then switches (forward-only)', () => {
    expect(at('18:29', creative)).toEqual({ type: 'ignore' })
    expect(at('18:30', creative)).toMatchObject({ type: 'switch', event: { id: 'art' }, reason: 'superseded' })
  })

  it('an early ACTIVE flag on the next crew does not cut the call', () => {
    const events = day().map((e) => (e.id === 'art' ? { ...e, status: EventStatus.Active } : e))
    expect(at('18:20', { ...creative, events })).toEqual({ type: 'ignore' })
  })

  it('never switches backward once the current slot has begun', () => {
    const art = { currentEventId: 'art', currentStartMs: d('18:30') }
    const withCreativeActive = day().map((e) => (e.id === 'creative' ? { ...e, status: EventStatus.Active } : e))
    expect(at('18:40', { ...art, events: withCreativeActive })).toEqual({ type: 'ignore' })
    expect(canSwitchTo(day()[1], d('18:30'), d('18:40'))).toBe(false)
  })

  it('provisional: started before its slot, it yields to the crew whose slot is actually running', () => {
    // idle at 18:12 -> Creative (closest) in the lead window; Music's slot (17:30) is still running
    const prov = { currentEventId: 'creative', currentStartMs: d('18:15') }
    expect(at('18:12', prov)).toMatchObject({ type: 'switch', event: { id: 'music' } })
    // but Art (18:30) is not running at 18:20 and the current slot has begun: stay
    expect(at('18:20', prov)).toEqual({ type: 'ignore' })
  })

  it('no humans: no switch', () => {
    expect(at('18:31', { ...creative, humans: 0 })).toEqual({ type: 'ignore' })
  })
})

describe('early ACTIVE flags never record on their own', () => {
  it('a 20:00 event set ACTIVE at 17:00 with nobody present: nothing records; Music at 17:30 does', () => {
    const events = day().map((e) => (e.id === 're' ? { ...e, status: EventStatus.Active } : e))
    expect(at('17:00', { humans: 0, events })).toEqual({ type: 'ignore' })
    expect(at('17:00', { humans: 3, events })).toEqual({ type: 'ignore' }) // outside every window
    expect(at('17:30', { humans: 3, events })).toMatchObject({ type: 'start', event: { id: 'music' } })
  })

  it('idle at 18:15 with Art set ACTIVE; Creative crew joins at 18:16 -> Creative; Art takes over at 18:30', () => {
    const events = day().map((e) => (e.id === 'art' ? { ...e, status: EventStatus.Active } : e))
    const first = at('18:16', { events })
    expect(first).toMatchObject({ type: 'start', event: { id: 'creative' } })
    const cur = { currentEventId: 'creative', currentStartMs: d('18:15'), events }
    expect(at('18:29', cur)).toEqual({ type: 'ignore' })
    expect(at('18:30', cur)).toMatchObject({ type: 'switch', event: { id: 'art' } })
  })

  it('full 2026-10-20 day, events set ACTIVE 15 min early, people 17:25-20:45: one session per event, split at each scheduled start', () => {
    const starts = [['music', '17:30'], ['creative', '18:15'], ['art', '18:30'], ['events', '19:00'], ['merch', '19:30'], ['re', '20:00']] as const
    let cur: string | null = null
    let curStart: number | null = null
    const sessions: Array<{ id: string; at: number }> = []
    for (let now = d('17:25'); now <= d('20:45'); now += MIN) {
      const events = [
        ...starts.map(([id, hhmm]) =>
          sched(id, hhmm, { status: now >= d(hhmm) - 15 * MIN ? EventStatus.Active : EventStatus.Scheduled }),
        ),
        sched('t1', '18:00', {}, '21'),
        sched('t2', '18:00', {}, '21'),
      ]
      const a = decideWindowAction({ ...lo, nowMs: now, currentEventId: cur, currentStartMs: curStart, humans: 5, events })
      if (a.type === 'start' || a.type === 'switch') {
        cur = a.event.id
        curStart = a.event.scheduledStartMs
        sessions.push({ id: a.event.id, at: now })
      }
    }
    expect(sessions.map((s) => s.id)).toEqual(['music', 'creative', 'art', 'events', 'merch', 're'])
    expect(sessions[0].at).toBe(d('17:25'))
    starts.forEach(([, hhmm], i) => {
      if (i > 0) expect(sessions[i].at).toBe(d(hhmm))
    })
  })
})

describe('post-call lingering', () => {
  it('Real Estate 20:00: no new session at 21:45, but a restart at 20:40 after a short empty stop', () => {
    expect(at('21:45', { events: [day()[5]] })).toEqual({ type: 'ignore' })
    expect(at('20:40', { events: [day()[5]] })).toMatchObject({ type: 'start', event: { id: 're' } })
  })
})

describe('StartBackoff', () => {
  it('blocks for 5 minutes after a failure and gives up after 3', () => {
    const b = new StartBackoff()
    expect(b.allows('e', 0)).toBe(true)
    expect(b.noteFailure('e', 0)).toBe(false)
    expect(b.allows('e', RETRY_BACKOFF_MS - 1)).toBe(false)
    expect(b.allows('e', RETRY_BACKOFF_MS)).toBe(true)
    b.noteFailure('e', RETRY_BACKOFF_MS)
    expect(b.noteFailure('e', 2 * RETRY_BACKOFF_MS)).toBe(true)
    expect(b.allows('e', 100 * RETRY_BACKOFF_MS)).toBe(false)
    expect(b.noteFailure('e', 101 * RETRY_BACKOFF_MS)).toBe(false)
    expect(b.allows('other', 0)).toBe(true)
    expect(MAX_ATTEMPTS).toBe(3)
  })

  it('is keyed by event occurrence: the same id next week is not blocked', () => {
    const b = new StartBackoff()
    const thisWeek = eventKey({ id: 'weekly', scheduledStartMs: d('18:15') })
    const nextWeek = eventKey({ id: 'weekly', scheduledStartMs: d('18:15') + 7 * 24 * 60 * MIN })
    for (let i = 0; i < 3; i++) b.noteFailure(thisWeek, i * RETRY_BACKOFF_MS)
    expect(b.allows(thisWeek, 10 * RETRY_BACKOFF_MS)).toBe(false)
    expect(b.allows(nextWeek, 10 * RETRY_BACKOFF_MS)).toBe(true)
  })

  it('clear forgets an event; prune drops entries outside the kept set', () => {
    const b = new StartBackoff()
    b.noteFailure('a', 0)
    b.noteFailure('b', 0)
    b.clear('a')
    expect(b.allows('a', 1)).toBe(true)
    b.prune(new Set())
    expect(b.allows('b', 1)).toBe(true)
  })

  it('classifies stop reasons', () => {
    for (const r of ['empty', 'max-duration', 'event-ended', 'superseded', 'shutdown']) expect(isFailureStop(r)).toBe(false)
    expect(isFailureStop('disconnected')).toBe(true)
  })
})

describe('handoff-aware switching (a call that is still going)', () => {
  const cur = { currentEventId: 'creative', currentStartMs: d('18:15') }
  const ids = ['a', 'b', 'c', 'd']
  const spoke = (mins: Record<string, number>, now: string) =>
    new Map(Object.entries(mins).map(([id, m]) => [id, d(now) - m * MIN]))
  const hand = (over: Record<string, unknown> = {}) => ({
    deferMaxMs: 30 * MIN,
    presentIds: ids,
    lastSpokeMs: spoke({ a: 1, b: 2, c: 3 }, '18:31'),
    firstSpokeMs: spoke({ a: 60, b: 60, c: 60 }, '18:31'),
    startPresentIds: new Set<string>(),
    ...over,
  })

  it('without the handoff input, switches immediately (old behavior)', () => {
    expect(at('18:31', cur)).toMatchObject({ type: 'switch', event: { id: 'art' } })
  })

  it('defers while most people present spoke recently', () => {
    expect(at('18:31', { ...cur, handoff: hand() })).toMatchObject({ type: 'ignore' })
  })

  it('switches when the old speakers have mostly left (rule 1)', () => {
    expect(at('18:31', { ...cur, handoff: hand({ presentIds: ['a', 'x', 'y', 'z'] }) })).toMatchObject({ type: 'switch' })
    expect(at('18:31', { ...cur, handoff: hand({ presentIds: ['x', 'y'] }) })).toMatchObject({ type: 'switch' })
  })

  it('switches when nobody has spoken for 5 minutes (rule 2)', () => {
    expect(at('18:31', { ...cur, handoff: hand({ lastSpokeMs: spoke({ a: 6, b: 7 }, '18:31') }) })).toMatchObject({ type: 'switch' })
  })

  it('switches once the cap has elapsed (rule 3), and not before', () => {
    const h = (now: string) => hand({ lastSpokeMs: spoke({ a: 1, b: 1, c: 1 }, now) })
    expect(at('18:59', { ...cur, handoff: h('18:59') })).toMatchObject({ type: 'ignore' })
    expect(at('19:00', { ...cur, handoff: h('19:00') })).toMatchObject({ type: 'switch' })
  })

  it('a cap of 0 is the kill switch', () => {
    expect(at('18:31', { ...cur, handoff: hand({ deferMaxMs: 0 }) })).toMatchObject({ type: 'switch' })
  })

  it('provisional sessions keep the immediate switch', () => {
    const p = { currentEventId: 'events', currentStartMs: d('19:00'), handoff: hand({ lastSpokeMs: spoke({ a: 1, b: 1, c: 1 }, '18:40') }) }
    expect(at('18:40', p)).toMatchObject({ type: 'switch', event: { id: 'art' } })
  })

  it('the next crew joining early and talking does not count as carry-over', () => {
    // A's people left; B's people joined 5 min early (18:25) and talk. Switch at B's start, not after the cap.
    const h = hand({
      presentIds: ['x', 'y'],
      lastSpokeMs: spoke({ x: 1, y: 1 }, '18:31'),
      firstSpokeMs: spoke({ x: 6, y: 6 }, '18:31'),
    })
    expect(at('18:31', { ...cur, handoff: h })).toMatchObject({ type: 'switch', event: { id: 'art' } })
  })

  it('people present when the session began count as the old call', () => {
    const h = hand({ firstSpokeMs: new Map(), startPresentIds: new Set(ids) })
    expect(at('18:31', { ...cur, handoff: h })).toEqual({ type: 'ignore', deferredTo: expect.objectContaining({ id: 'art' }) })
  })

  it('keeps the deferred target after its window closes, and switches at the cap even then', () => {
    // art ends 18:40 (short end), so its window closes while the old call is still talking.
    const events = day().map((e) => (e.id === 'art' ? { ...e, scheduledEndMs: d('18:40') } : e))
    const h = (now: string, pending: string | null) => hand({ lastSpokeMs: spoke({ a: 1, b: 1, c: 1 }, now), pendingTargetId: pending })
    expect(at('18:35', { ...cur, events, handoff: h('18:35', null) })).toMatchObject({ type: 'ignore', deferredTo: { id: 'art' } })
    // Window closed and old speakers left: without the remembered target nothing is eligible...
    const left = (pending: string | null) => hand({ presentIds: ['x'], lastSpokeMs: spoke({ a: 1 }, '18:45'), pendingTargetId: pending })
    expect(at('18:45', { ...cur, events, handoff: left(null) })).toEqual({ type: 'ignore' })
    // ...with it, the switch happens.
    expect(at('18:45', { ...cur, events, handoff: left('art') })).toMatchObject({ type: 'switch', event: { id: 'art' } })
    // At the cap (18:30 + 30) it switches even with everyone still talking.
    expect(at('19:00', { ...cur, events, handoff: h('19:00', 'art') })).toMatchObject({ type: 'switch' })
  })
})
