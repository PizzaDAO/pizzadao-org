import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { decideWindowAction, eventKey, EventStatus, type EventInfo } from './event-lifecycle.js'
import { mergeSlots, SlotMemory, slotsFromLive, staleSlots } from './slots.js'

const CH = 'call-channel'
const HOUR = 3_600_000
const WEEK = 7 * 24 * HOUR
const T20 = Date.parse('2026-11-03T20:00:00Z')
const T21 = T20 + HOUR
const T19 = T20 - HOUR

const ev = (over: Partial<EventInfo> & { id: string }): EventInfo => ({
  name: over.id,
  channelId: CH,
  status: EventStatus.Scheduled,
  scheduledStartMs: T20,
  scheduledEndMs: null,
  recurrenceIntervalMs: WEEK,
  ...over,
})

const memory = (log: (m: string) => void = () => {}) =>
  new SlotMemory(path.join(mkdtempSync(path.join(tmpdir(), 'slots-')), 'slots.json'), CH, log)

const decide = (events: EventInfo[]) =>
  decideWindowAction({
    callChannelId: CH,
    maxCallMs: 3 * HOUR,
    nowMs: T20 + 60_000,
    currentEventId: 'b',
    currentStartMs: T19,
    humans: 5,
    events,
  })

describe('stale slots after a reschedule', () => {
  it('replay: remembered at 20:00, patched to 21:00, other call recording from 19:00 -> no supersede at 20:00', () => {
    const logs: string[] = []
    const m = memory((l) => logs.push(l))
    const crewB = ev({ id: 'b', scheduledStartMs: T19 })

    // Earlier in the day the event is still at 20:00 and gets remembered.
    m.observe([ev({ id: 'a', scheduledStartMs: T20 }), crewB], T19 - 6 * HOUR)
    // Patched an hour later while the other call is recording.
    const keep = new Set([eventKey(crewB)])
    const live = [ev({ id: 'a', scheduledStartMs: T21 }), crewB]
    m.observe(live, T19 + 30 * 60_000, keep)
    expect(logs.some((l) => l.includes('slot dropped') && l.includes(`a:${T20}`))).toBe(true)

    const merged = m.merge(live, keep)
    expect(merged.some((e) => eventKey(e) === `a:${T20}`)).toBe(false)
    expect(decide(merged).type).toBe('ignore')
  })

  it('control: an unfiltered stale remembered slot would supersede the running call', () => {
    const stale = slotsFromLive([ev({ id: 'a', scheduledStartMs: T20 })], CH)
    const live = [ev({ id: 'a', scheduledStartMs: T21 }), ev({ id: 'b', scheduledStartMs: T19 })]
    expect(decide(mergeSlots(live, stale)).type).toBe('switch')
  })

  it('mergeSlots drops a stale slot from an older build even if never observed', () => {
    const stale = slotsFromLive([ev({ id: 'a', scheduledStartMs: T20 })], CH)
    const live = [ev({ id: 'a', scheduledStartMs: T21 }), ev({ id: 'b', scheduledStartMs: T19 })]
    expect(decide(mergeSlots(live, stale, { callChannelId: CH })).type).toBe('ignore')
  })

  it('drops the stale slot when the old start is already in its lead window', () => {
    const m = memory()
    m.observe([ev({ id: 'a', scheduledStartMs: T20 })], T20 - 3 * HOUR)
    m.observe([ev({ id: 'a', scheduledStartMs: T21 })], T20 - 5 * 60_000)
    expect(m.all().some((s) => s.scheduledStartMs === T20)).toBe(false)
    expect(m.all().some((s) => s.scheduledStartMs === T21)).toBe(true)
  })

  it('keeps the derived previous occurrence (series jumped to next week)', () => {
    const m = memory()
    m.observe([ev({ id: 'a', scheduledStartMs: T20 })], T20 - 3 * HOUR)
    const live = [ev({ id: 'a', scheduledStartMs: T20 + WEEK })]
    m.observe(live, T20 + 5 * 60_000)
    expect(m.all().some((s) => s.scheduledStartMs === T20)).toBe(true)
    expect(m.merge(live).some((e) => eventKey(e) === `a:${T20}`)).toBe(true)
  })

  it('keeps the slot of the session being recorded', () => {
    const slot = slotsFromLive([ev({ id: 'a', scheduledStartMs: T20 })], CH)
    const live = [ev({ id: 'a', scheduledStartMs: T21 })]
    expect(staleSlots(live, slot, CH, new Set([`a:${T20}`]))).toEqual([])
    expect(staleSlots(live, slot, CH).map((d) => d.slot.scheduledStartMs)).toContain(T20)
  })

  it('uses 24h when the event is not recurring', () => {
    const slot = slotsFromLive([ev({ id: 'a', scheduledStartMs: T20, recurrenceIntervalMs: null })], CH)
    const near = [ev({ id: 'a', scheduledStartMs: T21, recurrenceIntervalMs: null })]
    expect(staleSlots(near, slot, CH)).toHaveLength(1)
    const far = [ev({ id: 'a', scheduledStartMs: T20 + 30 * HOUR, recurrenceIntervalMs: null })]
    expect(staleSlots(far, slot, CH)).toEqual([])
  })

  it('ignores other events and other channels', () => {
    const slot = slotsFromLive([ev({ id: 'a', scheduledStartMs: T20 })], CH)
    expect(staleSlots([ev({ id: 'b', scheduledStartMs: T21 })], slot, CH)).toEqual([])
    expect(staleSlots([ev({ id: 'a', scheduledStartMs: T21, channelId: 'other' })], slot, CH)).toEqual([])
  })
})
