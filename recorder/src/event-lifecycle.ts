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
): EventAction {
  if (event.status === EventStatus.Completed || event.status === EventStatus.Canceled) {
    return event.id === currentEventId ? { type: 'stop', reason: 'event-ended' } : { type: 'ignore' }
  }

  if (event.status !== EventStatus.Active) return { type: 'ignore' }
  if (event.channelId !== o.callChannelId) return { type: 'ignore' }
  if (event.id === currentEventId) return { type: 'ignore' }
  if (!fresh && isStaleActive(event, o)) return { type: 'ignore' }

  return currentEventId === null
    ? { type: 'start', event }
    : { type: 'switch', event, reason: 'superseded' }
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
/** A running session is handed to the next event once that event is this close to starting. */
export const SWITCH_LEAD_MS = 5 * 60_000

/** [open, close] of the event's recording window, or null if it has no scheduled start. */
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
    return w !== null && o.nowMs >= w.openMs && o.nowMs <= w.closeMs
  })
}

/** Of overlapping windows, the event whose scheduled start is closest to now (earlier start wins ties). */
export function pickWindowEvent(events: EventInfo[], o: LifecycleOptions): EventInfo | null {
  const c = eventsInWindow(events, o)
  c.sort(
    (a, b) =>
      Math.abs((a.scheduledStartMs as number) - o.nowMs) - Math.abs((b.scheduledStartMs as number) - o.nowMs) ||
      (a.scheduledStartMs as number) - (b.scheduledStartMs as number),
  )
  return c[0] ?? null
}

/** What happened to an event whose recording ended on its own (empty / max-duration). */
export interface FinishedInfo {
  capturedAudio: boolean
}

export interface WindowInput extends LifecycleOptions {
  currentEventId: string | null
  /** Humans (not bots) in the call channel right now. */
  humans: number
  events: EventInfo[]
  finished: ReadonlyMap<string, FinishedInfo>
}

/**
 * Should a recording start (or switch) because humans are in the channel during
 * an event window? Never without humans or without a covering event.
 */
export function decideWindowAction(i: WindowInput): EventAction {
  if (i.humans <= 0) return { type: 'ignore' }
  const event = pickWindowEvent(i.events, i)
  if (!event || event.id === i.currentEventId) return { type: 'ignore' }
  // Finished on its own: only restart when that session captured nothing (an early empty stop).
  const done = i.finished.get(event.id)
  if (done?.capturedAudio) return { type: 'ignore' }
  if (i.currentEventId === null) return { type: 'start', event }
  // Back-to-back: hand over once the next event is about to start.
  if ((event.scheduledStartMs as number) - i.nowMs > SWITCH_LEAD_MS) return { type: 'ignore' }
  return { type: 'switch', event, reason: 'superseded' }
}
