// POST /api/crew/<crewId>/sessions/<id>/retry
//
// Retry the steps of a session that failed (no Discord id stored yet), with the session's stored fields.
// Steps that already exist are never repeated. Leads of the session's crew and guild admins; off unless
// education.editEnabled.
import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { changeStatusCode, requireOwnedSession } from '@/app/lib/education-sessions/owned'
import { retrySession } from '@/app/lib/education-sessions/run'

export const runtime = 'nodejs'
export const maxDuration = 60

type Ctx = { params: Promise<{ crewId: string; sessionId: string }> }

const POST_HANDLER = async (_request: NextRequest, { params }: Ctx) => {
  const { crewId, sessionId } = await params
  await requireOwnedSession(crewId, sessionId)
  if (!(await toggleEnabled('education.editEnabled').catch(() => false))) {
    return NextResponse.json({ status: 'disabled' }, { status: 409, headers: NO_STORE_HEADERS })
  }
  const result = await retrySession(sessionId)
  return NextResponse.json(result, { status: changeStatusCode(result.status), headers: NO_STORE_HEADERS })
}

export const POST = withErrorHandling(POST_HANDLER)
