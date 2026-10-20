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
  /** Whether a human has been in the channel at any point of this session. */
  private everPresent = false

  constructor(
    private readonly startedAtMs: number,
    private readonly limits: StopLimits,
    /**
     * Until this time, "empty" cannot fire if no human has been present yet (an event set
     * ACTIVE early on an empty channel). null = no protection.
     */
    private readonly noShowUntilMs: number | null = null,
  ) {}

  /** Report how many humans are in the channel right now. */
  observeHumans(count: number, nowMs: number): void {
    if (count > 0) {
      this.emptySinceMs = null
      this.everPresent = true
    }
    else if (this.emptySinceMs === null) this.emptySinceMs = nowMs
  }

  /** The reason to stop now, or null to keep recording. Max duration wins ties. */
  check(nowMs: number): StopReason | null {
    if (nowMs - this.startedAtMs >= this.limits.maxCallMs) return 'max-duration'
    if (!this.everPresent && this.noShowUntilMs !== null && nowMs < this.noShowUntilMs) return null
    if (this.emptySinceMs !== null && nowMs - this.emptySinceMs >= this.limits.emptyGraceMs) return 'empty'
    return null
  }
}
