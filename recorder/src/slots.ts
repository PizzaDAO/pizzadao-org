/**
 * Slot memory: the schedule occurrences the recorder has seen, persisted in DATA_DIR.
 *
 * Discord auto-ends an ACTIVE voice event whose channel is empty, and a recurring event then
 * shows next week's start (or vanishes), so the live event list forgets today's slot before the
 * humans arrive. Remembering (and, for simple recurring rules, deriving) occurrences keeps the
 * slot's window open. Pure helpers are exported for tests; SlotMemory only adds the file.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { EventStatus, eventKey, type EventInfo } from './event-lifecycle.js'

export const SLOT_RETENTION_MS = 24 * 3_600_000

export interface Slot {
  eventId: string
  name: string
  scheduledStartMs: number
  scheduledEndMs: number | null
  channelId: string
}

const slotKey = (s: Pick<Slot, 'eventId' | 'scheduledStartMs'>) => `${s.eventId}:${s.scheduledStartMs}`

/** Occurrences to remember from the live list: each call-channel event plus its derived previous one. */
export function slotsFromLive(live: EventInfo[], callChannelId: string): Slot[] {
  const out: Slot[] = []
  for (const e of live) {
    if (e.channelId !== callChannelId || e.scheduledStartMs === null) continue
    if (e.status !== EventStatus.Scheduled && e.status !== EventStatus.Active) continue
    const end = e.scheduledEndMs ?? null
    out.push({ eventId: e.id, name: e.name, scheduledStartMs: e.scheduledStartMs, scheduledEndMs: end, channelId: e.channelId })
    const iv = e.recurrenceIntervalMs
    if (iv && iv > 0) {
      out.push({
        eventId: e.id,
        name: e.name,
        scheduledStartMs: e.scheduledStartMs - iv,
        scheduledEndMs: end === null ? null : end - iv,
        channelId: e.channelId,
      })
    }
  }
  return out
}

/**
 * Union of live events and remembered slots (one entry per occurrence). A remembered slot counts
 * whatever the live event's status now is, except when the live event is CANCELED for that same
 * start. A live SCHEDULED/ACTIVE copy wins over its remembered copy.
 */
export function mergeSlots(live: EventInfo[], slots: Slot[]): EventInfo[] {
  const liveByKey = new Map(live.map((e) => [eventKey(e), e]))
  const out = [...live]
  for (const s of slots) {
    const l = liveByKey.get(slotKey(s))
    if (l && (l.status === EventStatus.Canceled || l.status === EventStatus.Scheduled || l.status === EventStatus.Active)) continue
    out.push({
      id: s.eventId,
      name: s.name,
      channelId: s.channelId,
      status: EventStatus.Scheduled,
      scheduledStartMs: s.scheduledStartMs,
      scheduledEndMs: s.scheduledEndMs,
    })
  }
  return out
}

export class SlotMemory {
  private slots = new Map<string, Slot>()

  constructor(
    private readonly file: string,
    private readonly callChannelId: string,
    private readonly log: (m: string) => void = () => {},
  ) {
    this.load()
  }

  private load(): void {
    try {
      if (!existsSync(this.file)) return
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as unknown
      if (!Array.isArray(raw)) return
      for (const s of raw as Slot[]) {
        if (s && typeof s.eventId === 'string' && typeof s.scheduledStartMs === 'number') this.slots.set(slotKey(s), s)
      }
    } catch (err) {
      this.log(`could not read slot memory: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Record what the live list shows, prune old slots, persist if anything changed. */
  observe(live: EventInfo[], nowMs: number): void {
    let changed = false
    for (const s of slotsFromLive(live, this.callChannelId)) {
      if (s.scheduledStartMs < nowMs - SLOT_RETENTION_MS) continue
      const k = slotKey(s)
      const old = this.slots.get(k)
      if (old && old.name === s.name && old.scheduledEndMs === s.scheduledEndMs) continue
      this.slots.set(k, s)
      changed = true
    }
    for (const [k, s] of this.slots) {
      if (s.scheduledStartMs < nowMs - SLOT_RETENTION_MS) {
        this.slots.delete(k)
        changed = true
      }
    }
    if (changed) this.save()
  }

  merge(live: EventInfo[]): EventInfo[] {
    return mergeSlots(live, [...this.slots.values()])
  }

  all(): Slot[] {
    return [...this.slots.values()]
  }

  private save(): void {
    try {
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify([...this.slots.values()]))
      renameSync(tmp, this.file)
    } catch (err) {
      this.log(`could not write slot memory: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
