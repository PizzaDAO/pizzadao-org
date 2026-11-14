// PATCH /api/crew/<crewId>/sessions/<id>
//
// Edit a scheduled session in place: the same Discord event, announcement and general post are
// updated (never recreated). Body: the schedule form's fields plus `notify` (post a short update reply).
// Leads of the session's crew and guild admins only; off unless education.editEnabled.
import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { ValidationError } from '@/app/lib/errors/api-errors'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'
import { parseSessionExtras, parseSessionInput, SessionInputError } from '@/app/lib/education-sessions/build'
import { changeStatusCode, requireOwnedSession } from '@/app/lib/education-sessions/owned'
import { editSession } from '@/app/lib/education-sessions/run'

export const runtime = 'nodejs'
export const maxDuration = 60

type Ctx = { params: Promise<{ crewId: string; sessionId: string }> }

const PATCH_HANDLER = async (request: NextRequest, { params }: Ctx) => {
  const { crewId, sessionId } = await params
  const { discordId } = await requireOwnedSession(crewId, sessionId)
  const body = await request.json().catch(() => null)
  let session, extras
  try {
    session = parseSessionInput(body)
    extras = parseSessionExtras(body)
  } catch (e) {
    if (e instanceof SessionInputError) throw new ValidationError(e.message)
    throw e
  }
  const notify = !!(body && typeof body === 'object' && (body as { notify?: unknown }).notify === true)
  const result = await editSession(sessionId, session, extras, discordId, { notify })
  return NextResponse.json(result, { status: changeStatusCode(result.status), headers: NO_STORE_HEADERS })
}

export const PATCH = withErrorHandling(PATCH_HANDLER)
