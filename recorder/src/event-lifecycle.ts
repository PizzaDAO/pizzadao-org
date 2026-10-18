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
