// POST /api/crew/education/sessions
//
// Schedule an education session: Discord event (flyer cover) + announcement with the flyer + optional
// general post + Telegram mirror, idempotently (app/lib/education-sessions/run.ts). Education crew
// leads and guild admins only. Off unless education.sessionAnnounceEnabled; when off nothing is created.
import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { ValidationError } from '@/app/lib/errors/api-errors'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'
import { requireEducationManager } from '@/app/lib/education-sessions/access'
import { parseSessionInput, SessionInputError } from '@/app/lib/education-sessions/build'
import { scheduleEducationSession } from '@/app/lib/education-sessions/run'

export const runtime = 'nodejs'
export const maxDuration = 60

type Ctx = { params: Promise<{ crewId: string }> }

const POST_HANDLER = async (request: NextRequest, { params }: Ctx) => {
  const { crewId } = await params
  const discordId = await requireEducationManager(crewId)
  const body = await request.json().catch(() => null)
  let session
  try {
    session = parseSessionInput(body)
  } catch (e) {
    if (e instanceof SessionInputError) throw new ValidationError(e.message)
    throw e
  }
  const result = await scheduleEducationSession(session, discordId)
  const status = result.status === 'disabled' ? 409 : result.status === 'not-configured' ? 503 : 200
  return NextResponse.json(result, { status, headers: NO_STORE_HEADERS })
}

export const POST = withErrorHandling(POST_HANDLER)
