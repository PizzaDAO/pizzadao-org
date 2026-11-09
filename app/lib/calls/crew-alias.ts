/** Crew id aliases for attendance (setting calls.attendanceCrewAliases): the recorder's id -> the id sheets, missions and Slices use. */
import { loadSettings } from '@/app/lib/settings'
import { parseCrewAliases } from '@/app/lib/settings/registry'

/** The attendance crew id for a recorder crew id (calls.attendanceCrewAliases). Unaliased ids pass through. */
export function attendanceCrewId(crewId: string, aliases: ReadonlyMap<string, string>): string {
  return aliases.get(crewId.toLowerCase()) ?? crewId
}

/** Every crew id that maps to the canonical id, itself included: what a dedupe query must match. */
export function crewIdsFor(canonical: string, aliases: ReadonlyMap<string, string>): string[] {
  const out = new Set([canonical])
  for (const [from, to] of aliases) if (to.toLowerCase() === canonical.toLowerCase()) out.add(from)
  return [...out]
}

/** Aliases from settings; an unreadable setting falls back to no aliases (rows keep the recorder id). */
export async function loadCrewAliases(): Promise<Map<string, string>> {
  try {
    return parseCrewAliases((await loadSettings()).get('calls.attendanceCrewAliases'))
  } catch {
    return new Map()
  }
}
