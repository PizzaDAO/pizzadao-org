/**
 * After the recording: the live call view outlasts a recording that stopped while the call goes on (its
 * recording limit, or a lost voice connection). The recorder leaves the voice channel as before; only the
 * live-state heartbeat carries on for the same session, with `recording: false`, and keeps reporting who is
 * in the channel from the gateway's voice states (no voice connection needed).
 *
 * It ends (ended=true) when, whichever comes first:
 *   - the channel has had no humans for emptyGraceMs (calls.liveAfterRecordingEmptySeconds)
 *   - capMs since the recording started (calls.liveMaxHours)
 *   - the Discord event occurrence, once seen live, is no longer (completed or rolled on to the next
 *     occurrence: the end song may play; canceled or deleted: no song)
 *   - a new recording starts in that channel, the channel is no longer recordable, or the recorder shuts down
 *
 * Pure: no timers, no Discord.
 */
import { EventStatus, type EventInfo } from './event-lifecycle.js'
import type { StopReason } from './stop-conditions.js'

/**
 * Stop reasons after which the call itself may well go on: the live view stays up. Not event-ended (the call
 * is over), empty (nobody is left), superseded (another call takes the channel and its own live view),
 * shutdown or channel-disallowed.
 */
export const LIVE_CONTINUES_REASONS = ['max-duration', 'disconnected'] as const satisfies readonly StopReason[]

export function liveContinuesAfter(reason: StopReason): boolean {
  return (LIVE_CONTINUES_REASONS as readonly string[]).includes(reason)
}

export type AfterRecordingEnd = 'empty' | 'cap' | 'event-ended' | 'event-canceled' | 'superseded' | 'shutdown' | 'channel-disallowed'

export interface AfterRecordingLimits {
  emptyGraceMs: number
  capMs: number
}

export class AfterRecordingTracker {
  /** Since when the channel has had no humans (null = someone is here, or not observed yet). */
  private emptySinceMs: number | null = null

  constructor(
    /** When the recording started (the cap counts from here). */
    private readonly startedAtMs: number,
    private readonly limits: AfterRecordingLimits,
  ) {}

  observeHumans(count: number, nowMs: number): void {
    if (count > 0) this.emptySinceMs = null
    else if (this.emptySinceMs === null) this.emptySinceMs = nowMs
  }

  /** Why the live view should end now, or null to keep it up. The cap wins ties. */
  check(nowMs: number): 'cap' | 'empty' | null {
    if (nowMs - this.startedAtMs >= this.limits.capMs) return 'cap'
    if (this.emptySinceMs !== null && nowMs - this.emptySinceMs >= this.limits.emptyGraceMs) return 'empty'
    return null
  }
}

/** Without a known recurrence interval, a start moved later by at least this much is the next occurrence. */
export const ROLL_ON_MIN_MS = 12 * 3_600_000

/**
 * What Discord says about the recorded occurrence now. Matched by event id (Discord gives recurring events no
 * occurrence id): an edited start time is still the same occurrence; only a jump to a later start of at least
 * half the recurrence interval (else ROLL_ON_MIN_MS) while SCHEDULED counts as rolling on to the next one.
 *   live: scheduled or active; completed / rolled: the call ended (the end song may play);
 *   canceled / gone (deleted): the call is off (no song).
 */
export type OccurrenceState = 'live' | 'completed' | 'rolled' | 'canceled' | 'gone'

export function occurrenceState(events: readonly EventInfo[], eventId: string | null, recordedStartMs: number | null): OccurrenceState {
  const e = eventId ? events.find((x) => x.id === eventId) : undefined
  if (!e) return 'gone'
  if (e.status === EventStatus.Completed) return 'completed'
  if (e.status === EventStatus.Canceled) return 'canceled'
  if (e.status === EventStatus.Scheduled && recordedStartMs !== null && e.scheduledStartMs !== null) {
    const interval = e.recurrenceIntervalMs
    const minJump = interval && interval > 0 ? interval / 2 : ROLL_ON_MIN_MS
    if (e.scheduledStartMs - recordedStartMs >= minJump) return 'rolled'
  }
  return e.status === EventStatus.Scheduled || e.status === EventStatus.Active ? 'live' : 'gone'
}

/** True while the occurrence is scheduled or active. */
export function occurrenceLive(events: readonly EventInfo[], eventId: string | null, recordedStartMs: number | null): boolean {
  return occurrenceState(events, eventId, recordedStartMs) === 'live'
}
