// POST /api/crew/<crewId>/sessions/<id>/cancel
//
// Cancel a session: the Discord event is set to canceled and the announcement is edited to say so
// (posts are never deleted). Leads of the session's crew and guild admins; off unless education.editEnabled.
import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'
import { changeStatusCode, requireOwnedSession } from '@/app/lib/education-sessions/owned'
import { cancelSession } from '@/app/lib/education-sessions/run'

export const runtime = 'nodejs'
export const maxDuration = 60

type Ctx = { params: Promise<{ crewId: string; sessionId: string }> }

const POST_HANDLER = async (_request: NextRequest, { params }: Ctx) => {
  const { crewId, sessionId } = await params
  const { discordId } = await requireOwnedSession(crewId, sessionId)
  const result = await cancelSession(sessionId, discordId)
  // For cancel, 'canceled' is the success outcome (elsewhere it means "refused: already canceled").
  return NextResponse.json(result, { status: result.status === 'canceled' ? 200 : changeStatusCode(result.status), headers: NO_STORE_HEADERS })
}

export const POST = withErrorHandling(POST_HANDLER)
