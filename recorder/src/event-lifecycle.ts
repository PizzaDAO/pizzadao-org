/**
 * Pure decisions for starting, switching and stopping recordings (no Discord imports).
 *
 * Only the schedule window starts or switches a recording: humans are in the call
 * channel and a scheduled event's window covers now. Event status (SCHEDULED /
 * ACTIVE) is not a trigger: the scheduler sets events ACTIVE ~15 minutes early, which
 * would swallow the previous crew's call. COMPLETED / CANCELED never stops a session
 * (it only keeps the event from starting one while idle); a session ends by empty
 * grace, max duration, a forward switch or shutdown.
 */
import type { StopReason } from './stop-conditions.js'

/** Discord's GuildScheduledEventStatus values. */
export const EventStatus = { Scheduled: 1, Active: 2, Completed: 3, Canceled: 4 } as const

export interface EventInfo {
  id: string
  name: string
  channelId: string | null
  status: number
  /** Epoch ms of the scheduled start. */
  scheduledStartMs: number | null
  /** Epoch ms of the scheduled end, when the event has one. */
  scheduledEndMs?: number | null
  /** Spacing between occurrences for a simple daily/weekly recurring event; null/absent otherwise. */
  recurrenceIntervalMs?: number | null
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

/** A window opens this long before the scheduled start. */
export const WINDOW_LEAD_MS = 15 * 60_000
/** Without humans, a session started for an event is not stopped as "empty" before start + this. */
export const NO_SHOW_GRACE_MS = 15 * 60_000
/** For events with no scheduled end, the start window closes this long after the scheduled start... */
export const NO_END_WINDOW_MS = 90 * 60_000
/** After a failed start / fatal stop, wait this long before trying the same event again. */
export const RETRY_BACKOFF_MS = 5 * 60_000
export const MAX_ATTEMPTS = 3

/**
 * [open, close) of the event's START window, or null if it has no scheduled start. With a
 * scheduled end it closes then; otherwise at the earlier of the next event's scheduled
 * start in the call channel and start + 90 minutes (a running session is never cut by this).
 */
export function eventWindow(
  event: EventInfo,
  o: Pick<LifecycleOptions, 'callChannelId'>,
  events: EventInfo[],
): { openMs: number; closeMs: number } | null {
  const start = event.scheduledStartMs
  if (start === null) return null
  let closeMs = event.scheduledEndMs ?? null
  if (closeMs === null) {
    closeMs = start + NO_END_WINDOW_MS
    for (const e of events) {
      if (e.id === event.id || e.channelId !== o.callChannelId || e.status === EventStatus.Canceled) continue
      if (e.scheduledStartMs !== null && e.scheduledStartMs > start) closeMs = Math.min(closeMs, e.scheduledStartMs)
    }
  }
  return { openMs: start - WINDOW_LEAD_MS, closeMs }
}

/** Events in the call channel (SCHEDULED or ACTIVE) whose window covers now. */
export function eventsInWindow(events: EventInfo[], o: LifecycleOptions): EventInfo[] {
  return events.filter((e) => {
    if (e.channelId !== o.callChannelId) return false
    if (e.status !== EventStatus.Scheduled && e.status !== EventStatus.Active) return false
    const w = eventWindow(e, o, events)
    if (w !== null && o.nowMs >= w.openMs && o.nowMs < w.closeMs) return true
    // A host pressed Start late (or the bot restarted mid-call): an ACTIVE event whose start has
    // passed counts until MAX_CALL_MINUTES after it, even past the normal close. ACTIVE before the
    // scheduled start is not enough on its own.
    const start = e.scheduledStartMs
    return e.status === EventStatus.Active && start !== null && o.nowMs >= start && o.nowMs - start < o.maxCallMs
  })
}

/** Of several events: closest scheduled start to now, then the earlier start, then id. */
export function closestEvent(events: EventInfo[], nowMs: number): EventInfo | null {
  const c = [...events]
  c.sort(
    (a, b) =>
      Math.abs((a.scheduledStartMs as number) - nowMs) - Math.abs((b.scheduledStartMs as number) - nowMs) ||
      (a.scheduledStartMs as number) - (b.scheduledStartMs as number) ||
      a.id.localeCompare(b.id),
  )
  return c[0] ?? null
}

/**
 * Idle pick: prefer the in-window event whose slot has already begun (latest scheduled start
 * <= now; ties: id); only if none has begun, the closest upcoming one.
 */
export function pickWindowEvent(events: EventInfo[], o: LifecycleOptions): EventInfo | null {
  const inWindow = eventsInWindow(events, o)
  const begun = inWindow.filter((e) => (e.scheduledStartMs as number) <= o.nowMs)
  if (begun.length) {
    return [...begun].sort(
      (a, b) => (b.scheduledStartMs as number) - (a.scheduledStartMs as number) || a.id.localeCompare(b.id),
    )[0]
  }
  return closestEvent(inWindow, o.nowMs)
}

/**
 * Switching is forward-only and happens at the next event's scheduled start: the target must
 * start later than the current event and its slot must have begun.
 */
export function canSwitchTo(event: EventInfo, currentStartMs: number | null, nowMs: number): boolean {
  if (event.scheduledStartMs === null) return false
  if (nowMs < event.scheduledStartMs) return false
  return currentStartMs === null || event.scheduledStartMs > currentStartMs
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
 * The only start / switch decision. Idle + humans + an open window: start (the slot that has begun, else the closest upcoming). Running: switch forward to the latest-started slot that has begun. If the current
 * event's slot has not begun yet (provisional, started in the lead window), it may also switch
 * to an in-window event whose slot is actually running.
 */
export function decideWindowAction(i: WindowInput): EventAction {
  if (i.humans <= 0) return { type: 'ignore' }
  const inWindow = eventsInWindow(i.events, i)
  if (i.currentEventId === null) {
    const event = pickWindowEvent(i.events, i)
    return event ? { type: 'start', event } : { type: 'ignore' }
  }
  const provisional = i.currentStartMs !== null && i.nowMs < i.currentStartMs
  const eligible = inWindow.filter(
    (e) =>
      e.id !== i.currentEventId &&
      e.scheduledStartMs !== null &&
      e.scheduledStartMs <= i.nowMs &&
      (provisional || canSwitchTo(e, i.currentStartMs, i.nowMs)),
  )
  const event = closestEvent(eligible, i.nowMs)
  return event ? { type: 'switch', event, reason: 'superseded' } : { type: 'ignore' }
}

/** Identity of one occurrence of an event (ids can recur for recurring events). */
export function eventKey(e: Pick<EventInfo, 'id' | 'scheduledStartMs'>): string {
  return `${e.id}:${e.scheduledStartMs}`
}

/** A session that ran this long counts as a recovery and clears its failure count. */
export const RECOVERY_MS = 3 * 60_000

/** Per-event-occurrence retry limiter for failed starts / fatal stops. */
export class StartBackoff {
  private readonly m = new Map<string, { failures: number; lastMs: number }>()

  /** Record a failure; returns true when this was the one that exhausted the attempts. */
  noteFailure(key: string, nowMs: number): boolean {
    const s = this.m.get(key) ?? { failures: 0, lastMs: 0 }
    s.failures++
    s.lastMs = nowMs
    this.m.set(key, s)
    return s.failures === MAX_ATTEMPTS
  }

  allows(key: string, nowMs: number): boolean {
    const s = this.m.get(key)
    if (!s) return true
    return s.failures < MAX_ATTEMPTS && nowMs - s.lastMs >= RETRY_BACKOFF_MS
  }

  clear(key: string): void {
    this.m.delete(key)
  }

  /** Forget everything except the given keys (entries whose window has closed). */
  prune(keep: Set<string>): void {
    for (const k of [...this.m.keys()]) if (!keep.has(k)) this.m.delete(k)
  }
}

/** Stop reasons that are not failures; anything else (e.g. 'disconnected') counts as one. */
export function isFailureStop(reason: string): boolean {
  return !['empty', 'max-duration', 'event-ended', 'superseded', 'shutdown'].includes(reason)
}
