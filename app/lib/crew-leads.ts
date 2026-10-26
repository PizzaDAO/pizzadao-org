// jalapeno-82565 — crew-lead permissions for crew bounties.
//
// A crew lead is anyone whose row in the crew's own sheet roster has a Status
// matching lead/capo (see isLeadStatus). Every check FAILS CLOSED: any sheet or
// member-lookup error means "not a lead".
import { getCrewMappings } from './crew-mappings'
import { normalizeCrewId } from './crew-id'
import { CREW_SHEET_REVALIDATE_SECONDS, fetchCrewRoster } from './crew-sheet'
import { isLeadStatus } from './crew-lead-status'
import { findMemberIdByDiscordId } from './member-utils'

export { isLeadStatus }

/** Member ids of the crew's leads, per its sheet roster. Throws on sheet errors. */
export async function getCrewLeadMemberIds(crewId: string): Promise<Set<string>> {
  const id = normalizeCrewId(crewId)
  const { crews } = await getCrewMappings()
  const crew = crews.find((c) => c.id === id)
  if (!crew?.sheet) return new Set()
  const roster = await fetchCrewRoster(crew.sheet, CREW_SHEET_REVALIDATE_SECONDS)
  return new Set(roster.filter((m) => !!m.id && isLeadStatus(m.status)).map((m) => m.id))
}

/** Whether this Discord user is on the crew's own sheet roster (any status). Fails closed. */
export async function isOnCrewRoster(discordId: string, crewId: string | null | undefined): Promise<boolean> {
  if (!discordId || !crewId) return false
  try {
    const memberId = await findMemberIdByDiscordId(discordId)
    if (!memberId) return false
    const id = normalizeCrewId(crewId)
    const { crews } = await getCrewMappings()
    const crew = crews.find((c) => c.id === id)
    if (!crew?.sheet) return false
    const roster = await fetchCrewRoster(crew.sheet, CREW_SHEET_REVALIDATE_SECONDS)
    return roster.some((m) => m.id === memberId)
  } catch {
    return false
  }
}

/** Whether this Discord user leads this crew. Fails closed (false) on any error. */
export async function isCrewLead(discordId: string, crewId: string | null | undefined): Promise<boolean> {
  if (!discordId || !crewId) return false
  try {
    const memberId = await findMemberIdByDiscordId(discordId)
    if (!memberId) return false
    const leads = await getCrewLeadMemberIds(crewId)
    return leads.has(memberId)
  } catch {
    return false
  }
}

/** Lead of the crew, or guild admin. Fails closed. */
export async function canManageCrew(discordId: string, crewId: string | null | undefined): Promise<boolean> {
  if (await isCrewLead(discordId, crewId)) return true
  try {
    // Lazy: auth-guards pulls in the session module (needs SESSION_SECRET at import
    // time), which notifications / bounties callers shouldn't pay for or trip over.
    const { isAdminDiscordId } = await import('./auth-guards')
    return await isAdminDiscordId(discordId)
  } catch {
    return false
  }
}

/**
 * Who may approve / reject / cancel a bounty: its poster, a lead of its crew,
 * or a guild admin. (Approving additionally forbids the claimer; see completeBounty.)
 */
export async function canManageBounty(
  discordId: string,
  bounty: { createdBy: string; crewId?: string | null },
): Promise<boolean> {
  if (bounty.createdBy === discordId) return true
  return canManageCrew(discordId, bounty.crewId)
}
