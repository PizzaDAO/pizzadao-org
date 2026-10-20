/**
 * Pure decisions for Discord scheduled-event updates (no Discord imports).
 *
 * The Apps Script scheduler ends the previous event and starts the next one
 * through the other bot, and events are not always completed explicitly, so a
 * different event becoming ACTIVE must close the current recording and start the
 * next one. Events whose status never changes are caught by the empty-channel
 * and max-duration stops.
 */
import type { StopReason } from './stop-conditions.js'

/** Discord's GuildScheduledEventStatus values. */
export const EventStatus = { Scheduled: 1, Active: 2, Completed: 3, Canceled: 4 } as const

export interface EventInfo {
  id: string
  name: string
  channelId: string | null
  status: number
  /** Epoch ms of the scheduled start (used to skip stale ACTIVE events). */
  scheduledStartMs: number | null
  /** Epoch ms of the scheduled end, when the event has one. */
  scheduledEndMs?: number | null
}

export type EventAction =
  | { type: 'ignore' }
  | { type: 'start'; event: EventInfo }
  | { type: 'stop'; reason: StopReason }
  | { type: 'switch'; event: EventInfo; reason: StopReason }

export interface LifecycleOptions {
  callChannelId: string
  maxCallMs: number
  nowMs: number
}

/**
 * An ACTIVE event that was scheduled to start more than maxCallMs ago is a
 * leftover (events are never explicitly completed): a restart must not rejoin it.
 */
export function isStaleActive(event: EventInfo, o: LifecycleOptions): boolean {
  return event.scheduledStartMs !== null && o.nowMs - event.scheduledStartMs > o.maxCallMs
}

/**
 * What to do when `event` changes, given the id of the event being recorded
 * (null = idle). `fresh` is true for live gateway updates; the boot-time scan of
 * already-active events passes false so stale leftovers are skipped.
 */
export function decideEventAction(
  currentEventId: string | null,
  event: EventInfo,
  o: LifecycleOptions,
  fresh = true,
  /** Scheduled start of the event being recorded (null = unknown / idle). */
  currentStartMs: number | null = null,
): EventAction {
  if (event.status === EventStatus.Completed || event.status === EventStatus.Canceled) {
    return event.id === currentEventId ? { type: 'stop', reason: 'event-ended' } : { type: 'ignore' }
  }

  if (event.status !== EventStatus.Active) return { type: 'ignore' }
  if (event.channelId !== o.callChannelId) return { type: 'ignore' }
  if (event.id === currentEventId) return { type: 'ignore' }
  if (!fresh && isStaleActive(event, o)) return { type: 'ignore' }

  if (currentEventId === null) return { type: 'start', event }
  return canSwitchTo(event, currentStartMs, o.nowMs) ? { type: 'switch', event, reason: 'superseded' } : { type: 'ignore' }
}

/**
 * Switching is forward-only and happens at the next event's scheduled start: the target must
 * start later than the current event and its slot must have begun. (The scheduler sets events
 * ACTIVE ~15 min early, which must not cut the running call.)
 */
export function canSwitchTo(event: EventInfo, currentStartMs: number | null, nowMs: number): boolean {
  if (event.scheduledStartMs === null) return false
  if (nowMs < event.scheduledStartMs) return false
  return currentStartMs === null || event.scheduledStartMs > currentStartMs
}

/** When several events are already ACTIVE at boot, record the most recently started. */
export function pickBootEvent(events: EventInfo[], o: LifecycleOptions): EventInfo | null {
  const candidates = events.filter(
    (e) => e.status === EventStatus.Active && e.channelId === o.callChannelId && !isStaleActive(e, o),
  )
  candidates.sort((a, b) => (b.scheduledStartMs ?? 0) - (a.scheduledStartMs ?? 0))
  return candidates[0] ?? null
}


// ---- schedule-window trigger ------------------------------------------------
// Hosts and the scheduler do not reliably set events ACTIVE, so a recording also
// starts when humans are in the call channel during an event's scheduled window.

/** A window opens this long before the scheduled start. */
export const WINDOW_LEAD_MS = 15 * 60_000
/** Without humans, a session started for an event is not stopped as "empty" before start + this. */
export const NO_SHOW_GRACE_MS = 15 * 60_000

/** [open, close) of the event's recording window, or null if it has no scheduled start. */
export function eventWindow(event: EventInfo, maxCallMs: number): { openMs: number; closeMs: number } | null {
  if (event.scheduledStartMs === null) return null
  const closeMs = event.scheduledEndMs ?? event.scheduledStartMs + maxCallMs
  return { openMs: event.scheduledStartMs - WINDOW_LEAD_MS, closeMs }
}

/** Events in the call channel (SCHEDULED or ACTIVE) whose window covers now. */
export function eventsInWindow(events: EventInfo[], o: LifecycleOptions): EventInfo[] {
  return events.filter((e) => {
    if (e.channelId !== o.callChannelId) return false
    if (e.status !== EventStatus.Scheduled && e.status !== EventStatus.Active) return false
    const w = eventWindow(e, o.maxCallMs)
    return w !== null && o.nowMs >= w.openMs && o.nowMs < w.closeMs
  })
}

/** Of overlapping windows: closest scheduled start to now, then the earlier start, then id. */
export function pickWindowEvent(events: EventInfo[], o: LifecycleOptions): EventInfo | null {
  const c = eventsInWindow(events, o)
  c.sort(
    (a, b) =>
      Math.abs((a.scheduledStartMs as number) - o.nowMs) - Math.abs((b.scheduledStartMs as number) - o.nowMs) ||
      (a.scheduledStartMs as number) - (b.scheduledStartMs as number) ||
      a.id.localeCompare(b.id),
  )
  return c[0] ?? null
}

export interface WindowInput extends LifecycleOptions {
  currentEventId: string | null
  /** Scheduled start of the event being recorded (null if none / unknown). */
  currentStartMs: number | null
  /** Humans (not bots) in the call channel right now. */
  humans: number
  events: EventInfo[]
}

/**
 * Should a recording start (or switch) because humans are in the channel during an event
 * window? Within an open window, humans present and no session means start, whatever happened
 * before (a split recording beats a lost one). A running session only moves forward, at the
 * next event's scheduled start.
 */
export function decideWindowAction(i: WindowInput): EventAction {
  if (i.humans <= 0) return { type: 'ignore' }
  const event = pickWindowEvent(i.events, i)
  if (!event || event.id === i.currentEventId) return { type: 'ignore' }
  if (i.currentEventId === null) return { type: 'start', event }
  return canSwitchTo(event, i.currentStartMs, i.nowMs) ? { type: 'switch', event, reason: 'superseded' } : { type: 'ignore' }
}
