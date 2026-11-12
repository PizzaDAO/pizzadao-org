// POST /api/crew/education/sessions/<id>/reset
//
// Guild admins only. Clears the PENDING step markers of a session (steps left "unclear" after a crash or
// a Discord 5xx) so the next Schedule retries them. Check Discord for a half-made event or post first.
import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { NotFoundError } from '@/app/lib/errors/api-errors'
import { requireAdmin } from '@/app/lib/auth-guards'
import { normalizeCrewId } from '@/app/lib/crew-id'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'
import { EDUCATION_CREW_ID } from '@/app/lib/education-sessions/build'
import { resetPendingSteps } from '@/app/lib/education-sessions/run'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ crewId: string; sessionId: string }> }

const POST_HANDLER = async (_request: NextRequest, { params }: Ctx) => {
  const { crewId, sessionId } = await params
  if (normalizeCrewId(crewId) !== EDUCATION_CREW_ID) throw new NotFoundError('Sessions are only available for the education crew')
  const admin = await requireAdmin()
  if (!admin.ok) return admin.response
  return NextResponse.json(await resetPendingSteps(sessionId), { headers: NO_STORE_HEADERS })
}

export const POST = withErrorHandling(POST_HANDLER)
