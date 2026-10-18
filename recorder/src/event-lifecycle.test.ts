import { describe, expect, it } from 'vitest'
import { decideEventAction, EventStatus, isStaleActive, pickBootEvent, type EventInfo } from './event-lifecycle.js'

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
