/**
 * Which call occurrences are due a reminder, and which opted-in members want which occurrence.
 * Pure: no database, no network (the cron loads events and crews and passes them in).
 *
 * Calls come from Discord guild scheduled events in the call voice channel (the same source as the
 * pre-call agenda), so the event is the source of truth for the time. A recurring event reports its
 * next occurrence as its start time, so (eventId, startsAt) is one occurrence.
 */
import { normalizeCrewId } from '@/app/lib/crew-id'
import { resolveCrewForEvent } from '@/app/lib/calls/crew-map'
import { isCrewExcluded, type PostFilter } from '@/app/lib/calls/post-filters'

export const MINUTE_MS = 60_000
/** A reminder closer than this to the start is skipped: too late is worse than none. */
export const MIN_LEAD_MS = 5 * MINUTE_MS
/** The cron interval; the fetch horizon is the lead plus this much slack. */
export const HORIZON_SLACK_MS = 10 * MINUTE_MS
/** Crew id of the Community Call (the crew sheet slug). */
export const COMMUNITY_CREW_ID = 'community_call'
/** A reminder already sent for the same event this recently blocks another one (a moved call, until the correction DM exists). */
export const SAME_EVENT_WINDOW_MS = 6 * 60 * MINUTE_MS

export const SCHEDULED = 1

export interface RawEvent {
  id: string
  name: string
  status: number // 1 SCHEDULED, 2 ACTIVE, 3 COMPLETED, 4 CANCELED
  startsAt: Date
}

export interface CrewLite {
  id: string
  label: string
  event?: string
}

export interface CallOccurrence {
  eventId: string
  startsAt: Date
  crewId: string
  crewLabel: string
  refKey: string
}

export const refKeyFor = (eventId: string, startsAt: Date): string => `${eventId}:${startsAt.toISOString()}`

/** The event id inside a call refKey ("<id>:<iso>"). */
export const eventIdOf = (refKey: string): string => refKey.split(':')[0]

/** Due when 0 < start - now <= lead and start - now > 5 minutes. */
export function isDue(startsAt: Date, now: Date, leadMs: number): boolean {
  const d = startsAt.getTime() - now.getTime()
  return d > MIN_LEAD_MS && d <= leadMs
}

/** The occurrences that are due now: scheduled (not cancelled, completed or running), mapped to a crew, crew not excluded. */
export function dueOccurrences(o: {
  events: readonly RawEvent[]
  crews: readonly CrewLite[]
  filter: PostFilter
  now: Date
  leadMs: number
}): CallOccurrence[] {
  const out: CallOccurrence[] = []
  for (const ev of o.events) {
    if (ev.status !== SCHEDULED) continue
    if (!isDue(ev.startsAt, o.now, o.leadMs)) continue
    const hit = resolveCrewForEvent(o.crews, { eventId: ev.id, eventName: ev.name })
    if (!hit) continue
    const crew = o.crews.find((c) => c.id === hit.crewId)
    if (!crew || isCrewExcluded(crew, o.filter)) continue
    out.push({ eventId: ev.id, startsAt: ev.startsAt, crewId: crew.id, crewLabel: crew.label, refKey: refKeyFor(ev.id, ev.startsAt) })
  }
  return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.eventId.localeCompare(b.eventId))
}

export type CallsPref = 'NONE' | 'COMMUNITY' | 'MY_CREWS' | 'SELECTED'

export interface PrefLite {
  discordId: string
  calls: CallsPref
  crewIds: readonly string[]
}

const isCommunity = (crewId: string) => normalizeCrewId(crewId) === COMMUNITY_CREW_ID

/** Whether a member wants this crew's call. `memberCrewIds` is only read for MY_CREWS (resolved at send time). */
export function wantsCrew(pref: Pick<PrefLite, 'calls' | 'crewIds'>, crewId: string, memberCrewIds: readonly string[]): boolean {
  const id = normalizeCrewId(crewId)
  switch (pref.calls) {
    case 'COMMUNITY':
      return isCommunity(id)
    case 'MY_CREWS':
      return isCommunity(id) || memberCrewIds.some((c) => normalizeCrewId(c) === id)
    case 'SELECTED':
      return pref.crewIds.some((c) => normalizeCrewId(c) === id)
    default:
      return false
  }
}

/** Map the free-text Crews cell of a member row (labels or ids) onto crew ids. Unknown names are dropped. */
export function crewIdsFromCell(cell: unknown, crews: readonly CrewLite[]): string[] {
  const s = String(cell ?? '').trim()
  if (!s || s.toLowerCase() === 'none') return []
  const out = new Set<string>()
  for (const part of s.split(',')) {
    const n = normalizeCrewId(part)
    if (!n) continue
    const hit = crews.find((c) => c.id === n || normalizeCrewId(c.label) === n)
    if (hit) out.add(hit.id)
  }
  return [...out]
}
