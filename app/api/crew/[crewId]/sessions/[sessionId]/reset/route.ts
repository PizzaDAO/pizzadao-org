// POST /api/crew/education/sessions/<id>/reset
//
// Guild admins only. Clears the PENDING step markers of a session (steps left "unclear" after a crash or
// a Discord 5xx) so the next Schedule retries them. Check Discord for a half-made event or post first.
import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { NotFoundError } from '@/app/lib/errors/api-errors'
import { requireAdmin } from '@/app/lib/auth-guards'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'
import { isSessionCrew } from '@/app/lib/education-sessions/access'
import { prisma } from '@/app/lib/db'
import { resetPendingSteps } from '@/app/lib/education-sessions/run'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ crewId: string; sessionId: string }> }

const POST_HANDLER = async (_request: NextRequest, { params }: Ctx) => {
  const { crewId, sessionId } = await params
  if (!(await isSessionCrew(crewId))) throw new NotFoundError('Sessions are not available for this crew')
  const admin = await requireAdmin()
  if (!admin.ok) return admin.response
  const row = await prisma.crewSession.findUnique({ where: { id: sessionId }, select: { crewId: true } })
  if (!row) throw new NotFoundError('Session not found')
  return NextResponse.json(await resetPendingSteps(sessionId), { headers: NO_STORE_HEADERS })
}

export const POST = withErrorHandling(POST_HANDLER)
