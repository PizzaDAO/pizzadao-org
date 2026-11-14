/**
 * Who may schedule, edit and cancel sessions: leads of a crew listed in the education.sessionCrewIds
 * setting, and guild admins (canManageCrew, fails closed). Throws the API errors the route wrapper
 * turns into 401 / 403 / 404. Members below that bar can read the public list only.
 */
import { getSession } from '@/app/lib/session'
import { canManageCrew } from '@/app/lib/crew-leads'
import { normalizeCrewId } from '@/app/lib/crew-id'
import { getSetting } from '@/app/lib/settings'
import { ForbiddenError, NotFoundError, UnauthorizedError } from '@/app/lib/errors/api-errors'

/** The crews that may host sessions (setting). An unreadable setting means none. */
export async function sessionCrewIds(): Promise<string[]> {
  return (await getSetting('education.sessionCrewIds').catch(() => [] as string[])).map(normalizeCrewId)
}

export async function isSessionCrew(crewId: string): Promise<boolean> {
  return (await sessionCrewIds()).includes(normalizeCrewId(crewId))
}

/** The Discord id of the signed-in lead or admin for this crew. */
export async function requireSessionManager(crewId: string): Promise<string> {
  const id = normalizeCrewId(crewId)
  if (!(await isSessionCrew(id))) throw new NotFoundError('Sessions are not available for this crew')
  const session = await getSession()
  if (!session?.discordId) throw new UnauthorizedError()
  if (!(await canManageCrew(session.discordId, id))) throw new ForbiddenError('Crew leads only')
  return session.discordId
}

/** Non-throwing form for pages and the lead-only buttons: the manager's Discord id, or null. */
export async function sessionManagerOrNull(crewId: string): Promise<string | null> {
  return requireSessionManager(crewId).then(
    (id) => id,
    () => null,
  )
}
