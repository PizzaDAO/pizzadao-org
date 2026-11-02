/**
 * Crew rosters from the database (plans/sheets-cutover.md PR 5), in the same RosterRow shape the
 * crew sheet roster parser returns, so the crew page and the crew-lead permission check do not
 * change. Used once `sheets.source.crewRoles` is "db".
 */
import { prisma } from '@/app/lib/db'
import type { RosterRow } from '@/app/lib/crew-sheet'

export type DbCrewRole = {
  memberId: string | null
  name: string
  status: string
  city: string
  org: string
  skills: string
  turtles: string
  telegram: string
  attendance: string
  notes: string
}

export function toRosterRow(r: DbCrewRole): RosterRow {
  return {
    id: r.memberId ?? '',
    status: r.status,
    name: r.name,
    city: r.city,
    org: r.org,
    skills: r.skills,
    turtles: r.turtles,
    telegram: r.telegram,
    attendance: r.attendance,
    notes: r.notes,
  }
}

/** A crew's roster from the database, in order. Throws on a database error (callers fail closed). */
export async function loadCrewRosterFromDb(crewId: string): Promise<RosterRow[]> {
  const rows = await prisma.crewRole.findMany({ where: { crewId, archived: false }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] })
  return rows.map(toRosterRow)
}

export async function crewRolesFromDb(): Promise<boolean> {
  const { usesDb } = await import('@/app/lib/sheets-import/source')
  return usesDb('crewRoles')
}
