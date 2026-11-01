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
  /** When the limit counts from. */
  baseMs: number
  limitMs: number
  /** The call's scheduled start. */
  startMs: number
  hitAtMs?: number
  /** The channel emptied after the limit: the call is over, later events may lead-window again. */
  released?: boolean
}

const spent = (e: Entry, nowMs: number) => e.hitAtMs !== undefined || nowMs - e.baseMs >= e.limitMs

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
  noteStart(eventId: string, call: Omit<Entry, 'hitAtMs' | 'released'>): number {
    const existing = this.active(eventId, call.baseMs)
    if (existing) return existing.baseMs
    this.entries[eventId] = call
    this.save(call.baseMs)
    return call.baseMs
  }

  noteHit(eventId: string, nowMs: number): void {
    const e = this.entries[eventId]
    if (!e) return
    this.entries[eventId] = { ...e, hitAtMs: nowMs }
    this.save(nowMs)
  }

  /** A session ended before its call's clock began (a false start in the lead window): forget it. */
  noteEndedBeforeBase(eventId: string, nowMs: number): void {
    const e = this.entries[eventId]
    if (!e || e.hitAtMs !== undefined || nowMs >= e.baseMs) return
    delete this.entries[eventId]
    this.save(nowMs)
  }

  noteChannelEmpty(nowMs: number): void {
    let changed = false
    for (const id of Object.keys(this.entries)) {
      const e = this.active(id, nowMs)
      if (e && spent(e, nowMs) && !e.released) {
        e.released = true
        changed = true
      }
    }
    if (changed) this.save(nowMs)
  }

  /**
   * True when `event` must not start because a capped call used up its time: the call itself, any
   * event that began no later than it, and, until the channel empties, anything whose slot has not begun.
   */
  blocks(event: Pick<EventInfo, 'id' | 'scheduledStartMs'>, nowMs: number): boolean {
    const start = event.scheduledStartMs
    return Object.keys(this.entries).some((id) => {
      const e = this.active(id, nowMs)
      if (!e || !spent(e, nowMs)) return false
      if (id === event.id || start === null || start <= e.startMs) return true
      return !e.released && start > nowMs
    })
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
