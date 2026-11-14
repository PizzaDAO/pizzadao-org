/**
 * Shared by the per-session routes: the manager check for the crew in the URL plus proof that the
 * session really belongs to that crew (a lead of one crew can never touch another crew's session).
 */
import { prisma } from '@/app/lib/db'
import { normalizeCrewId } from '@/app/lib/crew-id'
import { NotFoundError } from '@/app/lib/errors/api-errors'
import { requireSessionManager } from './access'

export async function requireOwnedSession(crewId: string, sessionId: string): Promise<{ discordId: string; crewId: string }> {
  const discordId = await requireSessionManager(crewId)
  const row = await prisma.crewSession.findUnique({ where: { id: sessionId }, select: { crewId: true } })
  if (!row || row.crewId !== normalizeCrewId(crewId)) throw new NotFoundError('Session not found')
  return { discordId, crewId: row.crewId }
}

/** HTTP status for the non-success outcomes of edit, cancel and retry. */
export function changeStatusCode(status: string): number {
  switch (status) {
    case 'not-found':
      return 404
    case 'disabled':
    case 'ended':
    case 'canceled':
      return 409
    case 'not-configured':
      return 503
    default:
      return 200
  }
}
