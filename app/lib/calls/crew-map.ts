/**
 * Map a Discord scheduled event to a crew, the same way the Apps Script
 * scheduler does: the Crew Mappings sheet's `event` column holds the crew's
 * Discord event (ID, or a discord.com/events/<guild>/<id> link). Crew ids are
 * the sheet slugs (see crew-mappings.ts), e.g. "community_call".
 *
 * Order: exact event id, then (for events created ad hoc) the event name
 * equal to a crew id or label. No match leaves the crew unset; reviewers still
 * see the event name.
 */
import { normalizeCrewId } from '@/app/lib/crew-id'

export interface CrewRef {
  id: string
  label: string
  event?: string
}

/** The Discord snowflake in a sheet cell (bare id or event link), or null. */
export function extractEventId(raw: string | undefined | null): string | null {
  if (!raw) return null
  const ids = raw.match(/\d{17,20}/g)
  return ids ? ids[ids.length - 1] : null
}

export function resolveCrewForEvent(
  crews: readonly CrewRef[],
  event: { eventId?: string | null; eventName?: string | null },
): { crewId: string; crewLabel: string } | null {
  if (event.eventId) {
    const hit = crews.find((c) => extractEventId(c.event) === event.eventId)
    if (hit) return { crewId: hit.id, crewLabel: hit.label }
  }
  const name = normalizeCrewId(event.eventName)
  if (name) {
    const hit = crews.find((c) => c.id === name || normalizeCrewId(c.label) === name)
    if (hit) return { crewId: hit.id, crewLabel: hit.label }
    // "Community Call - Oct 18" style names
    const prefix = crews.find((c) => name.startsWith(`${c.id}_`))
    if (prefix) return { crewId: prefix.id, crewLabel: prefix.label }
  }
  return null
}
