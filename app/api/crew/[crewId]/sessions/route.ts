// POST /api/crew/<crewId>/sessions
//
// Schedule a session: Discord event (flyer cover) + announcement with the flyer + optional general
// post + Telegram mirror, idempotently (app/lib/education-sessions/run.ts). Leads of the crews in the
// education.sessionCrewIds setting and guild admins only. Off unless education.sessionAnnounceEnabled;
// when off nothing is created.
import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { ValidationError } from '@/app/lib/errors/api-errors'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'
import { normalizeCrewId } from '@/app/lib/crew-id'
import { requireSessionManager, sessionManagerOrNull } from '@/app/lib/education-sessions/access'
import { parseSessionExtras, parseSessionInput, SessionInputError } from '@/app/lib/education-sessions/build'
import { scheduleEducationSession } from '@/app/lib/education-sessions/run'
import { toggleEnabled } from '@/app/lib/settings/toggles'

export const runtime = 'nodejs'
export const maxDuration = 60

type Ctx = { params: Promise<{ crewId: string }> }

// GET: whether the signed-in user may schedule sessions (drives the lead-only links) and whether the
// manage actions are on. Never throws on auth.
const GET_HANDLER = async (_request: NextRequest, { params }: Ctx) => {
  const { crewId } = await params
  const canManage = !!(await sessionManagerOrNull(crewId))
  const editEnabled = canManage ? await toggleEnabled('education.editEnabled').catch(() => false) : false
  return NextResponse.json({ canManage, editEnabled }, { headers: NO_STORE_HEADERS })
}

const POST_HANDLER = async (request: NextRequest, { params }: Ctx) => {
  const { crewId } = await params
  const discordId = await requireSessionManager(crewId)
  const body = await request.json().catch(() => null)
  let session, extras
  try {
    session = parseSessionInput(body)
    extras = parseSessionExtras(body)
  } catch (e) {
    if (e instanceof SessionInputError) throw new ValidationError(e.message)
    throw e
  }
  const result = await scheduleEducationSession(normalizeCrewId(crewId), session, discordId, {}, extras)
  const status = result.status === 'disabled' || result.status === 'canceled' ? 409 : result.status === 'not-configured' ? 503 : 200
  return NextResponse.json(result, { status, headers: NO_STORE_HEADERS })
}

export const GET = withErrorHandling(GET_HANDLER)
export const POST = withErrorHandling(POST_HANDLER)
