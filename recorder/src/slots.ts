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

/** A channel to match: one id, or a predicate (several recordable channels). */
export type ChannelSel = string | ((channelId: string | null) => boolean)
const inChannel = (e: Pick<EventInfo, 'channelId'>, sel: ChannelSel): boolean => (typeof sel === 'string' ? e.channelId === sel : sel(e.channelId))

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
export function slotsFromLive(live: EventInfo[], callChannelId: ChannelSel): Slot[] {
  const out: Slot[] = []
  for (const e of live) {
    if (e.channelId === null || !inChannel(e, callChannelId) || e.scheduledStartMs === null) continue
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

const DEFAULT_INTERVAL_MS = 24 * 3_600_000

/** A remembered slot made stale by a reschedule, and the start its event has now. */
export interface DroppedSlot {
  slot: Slot
  movedToMs: number
}

/**
 * Remembered slots made stale by a reschedule. For each live call-channel SCHEDULED/ACTIVE event
 * at start S with recurrence interval I (24 h when unknown), a remembered slot of the same event
 * at a different start s is stale when |s - S| < I. A reschedule moves an occurrence by less than
 * one interval; the derived previous occurrence (S - I) is the legitimate "Discord auto-ended
 * today's slot and the series jumped ahead" case and is kept, as is any key in `keep` (the call
 * being recorded right now).
 */
export function staleSlots(
  live: EventInfo[],
  slots: Slot[],
  callChannelId: ChannelSel,
  nowMs: number,
  keep: ReadonlySet<string> = new Set(),
): DroppedSlot[] {
  const out: DroppedSlot[] = []
  const seen = new Set<string>()
  for (const e of live) {
    if (!inChannel(e, callChannelId) || e.scheduledStartMs === null) continue
    if (e.status !== EventStatus.Scheduled && e.status !== EventStatus.Active) continue
    const iv = e.recurrenceIntervalMs && e.recurrenceIntervalMs > 0 ? e.recurrenceIntervalMs : DEFAULT_INTERVAL_MS
    for (const s of slots) {
      if (s.eventId !== e.id || s.scheduledStartMs === e.scheduledStartMs) continue
      if (s.scheduledStartMs === e.scheduledStartMs - iv) continue
      if (Math.abs(s.scheduledStartMs - e.scheduledStartMs) >= iv) continue
      const k = slotKey(s)
      if (keep.has(k) || seen.has(k)) continue
      // An occurrence that has already begun (e.g. auto-ended today) while the series now points
      // ahead is not a reschedule of that occurrence: late arrivals still need its window.
      if (s.scheduledStartMs <= nowMs && e.scheduledStartMs > nowMs) continue
      seen.add(k)
      out.push({ slot: s, movedToMs: e.scheduledStartMs })
    }
  }
  return out
}

/**
 * Union of live events and remembered slots (one entry per occurrence). A remembered slot counts
 * whatever the live event's status now is, except when the live event is CANCELED for that same
 * start, or the event was rescheduled (see staleSlots; also covers a slot file written by an older
 * build). A live SCHEDULED/ACTIVE copy wins over its remembered copy.
 */
export function mergeSlots(
  live: EventInfo[],
  slots: Slot[],
  opts: { callChannelId?: ChannelSel; nowMs?: number; keep?: ReadonlySet<string> } = {},
): EventInfo[] {
  const liveByKey = new Map(live.map((e) => [eventKey(e), e]))
  const stale = new Set(
    opts.callChannelId === undefined ? [] : staleSlots(live, slots, opts.callChannelId, opts.nowMs ?? Date.now(), opts.keep).map((d) => slotKey(d.slot)),
  )
  const out = [...live]
  for (const s of slots) {
    if (stale.has(slotKey(s))) continue
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
    private readonly callChannelId: ChannelSel,
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
  observe(live: EventInfo[], nowMs: number, keep: ReadonlySet<string> = new Set()): void {
    let changed = false
    for (const d of staleSlots(live, [...this.slots.values()], this.callChannelId, nowMs, keep)) {
      this.log(`slot dropped: "${d.slot.name}" (${slotKey(d.slot)}) rescheduled to ${d.movedToMs}`)
      this.slots.delete(slotKey(d.slot))
      changed = true
    }
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

  merge(live: EventInfo[], keep: ReadonlySet<string> = new Set(), nowMs: number = Date.now()): EventInfo[] {
    return mergeSlots(live, [...this.slots.values()], { callChannelId: this.callChannelId, nowMs, keep })
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
