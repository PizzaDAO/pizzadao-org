/**
 * Pure stop logic for a recording. No timers, no Discord: callers feed it the
 * current human count and the clock, so it is trivially testable.
 *
 * A recording stops when, whichever comes first:
 *   - the channel has had no humans for `emptyGraceMs`
 *   - `maxCallMs` has elapsed since it started
 *   - the event ends (COMPLETED/CANCELED) or another event becomes ACTIVE; see
 *     event-lifecycle.ts, which feeds `stopReasonForEvent`.
 */

export type StopReason = 'event-ended' | 'empty' | 'max-duration' | 'superseded' | 'shutdown' | 'disconnected'

export interface StopLimits {
  maxCallMs: number
  emptyGraceMs: number
}

export class StopTracker {
  /** Since when the channel has had no humans (null = a human is present). */
  private emptySinceMs: number | null = null

  constructor(
    private readonly startedAtMs: number,
    private readonly limits: StopLimits,
  ) {}

  /** Report how many humans are in the channel right now. */
  observeHumans(count: number, nowMs: number): void {
    if (count > 0) this.emptySinceMs = null
    else if (this.emptySinceMs === null) this.emptySinceMs = nowMs
  }

  /** The reason to stop now, or null to keep recording. Max duration wins ties. */
  check(nowMs: number): StopReason | null {
    if (nowMs - this.startedAtMs >= this.limits.maxCallMs) return 'max-duration'
    if (this.emptySinceMs !== null && nowMs - this.emptySinceMs >= this.limits.emptyGraceMs) return 'empty'
    return null
  }
}
