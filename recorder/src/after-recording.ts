/**
 * After the recording: the live call view outlasts a recording that stopped while the call goes on (its
 * recording limit, or a lost voice connection). The recorder leaves the voice channel as before; only the
 * live-state heartbeat carries on for the same session, with `recording: false`, and keeps reporting who is
 * in the channel from the gateway's voice states (no voice connection needed).
 *
 * It ends (ended=true) when, whichever comes first:
 *   - the channel has had no humans for emptyGraceMs (calls.liveAfterRecordingEmptySeconds)
 *   - capMs since the recording started (calls.liveMaxHours)
 *   - the Discord event occurrence, once seen live, is no longer (completed, canceled, rolled to the next
 *     occurrence, or deleted)
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

export type AfterRecordingEnd = 'empty' | 'cap' | 'event-ended' | 'superseded' | 'shutdown' | 'channel-disallowed'

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

/**
 * True while Discord lists the occurrence as scheduled or active (same id and, when known, the same
 * scheduled start: a recurring event that ended rolls on to its next start).
 */
export function occurrenceLive(events: readonly EventInfo[], eventId: string | null, scheduledStartMs: number | null): boolean {
  if (!eventId) return false
  return events.some(
    (e) =>
      e.id === eventId &&
      (scheduledStartMs === null || e.scheduledStartMs === scheduledStartMs) &&
      (e.status === EventStatus.Scheduled || e.status === EventStatus.Active),
  )
}
