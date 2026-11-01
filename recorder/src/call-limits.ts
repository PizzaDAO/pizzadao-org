/**
 * State for events with a shorter recording limit (MAX_CALL_MINUTES_BY_EVENT), persisted in DATA_DIR.
 *
 * Stopping at the limit must end recording for the rest of that call, not just that session: people
 * are usually still in the channel, and the schedule window would otherwise start again, under the
 * same event or the next crew's. Keyed by event id, not occurrence, because a recurring event's
 * remembered occurrence can differ from its live start.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { EventInfo } from './event-lifecycle.js'

/** Longer than any call, far shorter than the gap between occurrences of a recurring event. */
export const LIMIT_HOLD_MS = 6 * 3_600_000

interface Entry {
  baseMs: number
  hitAtMs?: number
}

export class CallLimits {
  private entries: Record<string, Entry> = {}

  constructor(
    private readonly file: string,
    private readonly log: (msg: string) => void,
  ) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) this.entries = parsed as Record<string, Entry>
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.log(`could not read ${file}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private active(eventId: string, nowMs: number): Entry | null {
    const e = this.entries[eventId]
    return e && nowMs - e.baseMs < LIMIT_HOLD_MS ? e : null
  }

  /** The time this call's limit counts from: the first session's, or `baseMs` for a new call. */
  noteStart(eventId: string, baseMs: number): number {
    const existing = this.active(eventId, baseMs)
    if (existing) return existing.baseMs
    this.entries[eventId] = { baseMs }
    this.save(baseMs)
    return baseMs
  }

  noteHit(eventId: string, nowMs: number): void {
    const e = this.entries[eventId] ?? { baseMs: nowMs }
    this.entries[eventId] = { ...e, hitAtMs: nowMs }
    this.save(nowMs)
  }

  /**
   * True when `event` must not start: its own limit is used up, or another call hit its limit and
   * this event's slot has not begun (no lead-window start into the call that is still going).
   */
  blocks(event: Pick<EventInfo, 'id' | 'scheduledStartMs'>, nowMs: number, limitMs: number): boolean {
    const own = this.active(event.id, nowMs)
    if (own && (own.hitAtMs !== undefined || nowMs - own.baseMs >= limitMs)) return true
    const begun = event.scheduledStartMs !== null && event.scheduledStartMs <= nowMs
    return !begun && Object.keys(this.entries).some((id) => this.active(id, nowMs)?.hitAtMs !== undefined)
  }

  private save(nowMs: number): void {
    for (const id of Object.keys(this.entries)) if (!this.active(id, nowMs)) delete this.entries[id]
    try {
      writeFileSync(`${this.file}.tmp`, JSON.stringify(this.entries))
      renameSync(`${this.file}.tmp`, this.file)
    } catch (err) {
      this.log(`could not save ${this.file}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
