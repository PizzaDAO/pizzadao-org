/**
 * Who may schedule education sessions: leads of the education crew and guild admins (canManageCrew,
 * fails closed). Throws the API errors the route wrapper turns into 401 / 403 / 404.
 */
import { getSession } from '@/app/lib/session'
import { canManageCrew } from '@/app/lib/crew-leads'
import { normalizeCrewId } from '@/app/lib/crew-id'
import { ForbiddenError, NotFoundError, UnauthorizedError } from '@/app/lib/errors/api-errors'
import { EDUCATION_CREW_ID } from './build'

/** The Discord id of the signed-in lead. Only the education crew is supported for now. */
export async function requireEducationManager(crewId: string): Promise<string> {
  if (normalizeCrewId(crewId) !== EDUCATION_CREW_ID) throw new NotFoundError('Sessions are only available for the education crew')
  const session = await getSession()
  if (!session?.discordId) throw new UnauthorizedError()
  if (!(await canManageCrew(session.discordId, EDUCATION_CREW_ID))) throw new ForbiddenError('Education crew leads only')
  return session.discordId
}
