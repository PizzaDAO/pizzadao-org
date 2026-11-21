// GET/POST /api/crew/<crewId>/call/start  ("Start crew call" button, plans/neapolitan-96018.md)
//
// GET: whether the signed-in member may start this crew's call right now, and the state to show.
// POST: start it. The server decides everything (which occurrence, busy channel, cooldown, double start);
// the client only shows the answer. Off unless crewCall.startEnabled; previews never write to Discord.
import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { ForbiddenError, NotFoundError, UnauthorizedError } from '@/app/lib/errors/api-errors'
import { NO_STORE_HEADERS } from '@/app/lib/no-store'
import { getSession } from '@/app/lib/session'
import { rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { checkKeyedRateLimit, rateLimitResponse } from '@/app/lib/rate-limit'
import { normalizeCrewId } from '@/app/lib/crew-id'
import { findMemberIdByDiscordId } from '@/app/lib/member-utils'
import { runCrewCallStart, type Decision } from '@/app/lib/crew-call-start'
import {
  buildStartDeps,
  crewCallLinks,
  crewRoleId,
  loadCrewCallContext,
  mayStartCrewCall,
  readCrewCallState,
} from '@/app/lib/crew-call-start-live'

export const runtime = 'nodejs'
export const maxDuration = 30

type Ctx = { params: Promise<{ crewId: string }> }

type UiState = 'idle' | 'live' | 'busy' | 'not_scheduled' | 'cooldown' | 'unavailable'

function uiState(d: Decision): UiState {
  switch (d.kind) {
    case 'start_event':
    case 'start_adhoc':
      return 'idle'
    case 'already_live':
      return 'live'
    case 'channel_busy':
      return 'busy'
    case 'not_scheduled':
      return 'not_scheduled'
    case 'cooldown':
      return 'cooldown'
    default:
      return 'unavailable'
  }
}

const GET_HANDLER = async (_request: NextRequest, { params }: Ctx) => {
  const { crewId } = await params
  const id = normalizeCrewId(crewId)
  const none = NextResponse.json({ canStart: false }, { headers: NO_STORE_HEADERS })
  const session = await getSession()
  if (!session?.discordId) return none
  const ctx = await loadCrewCallContext(id)
  if (!ctx.enabled || !ctx.crewAllowed) return none
  if (!(await mayStartCrewCall(session.discordId, id, ctx.allowCrewMembers))) return none
  try {
    const st = await readCrewCallState(ctx, id)
    const links = crewCallLinks(st.voiceChannelId)
    return NextResponse.json(
      {
        canStart: true,
        state: uiState(st.decision),
        voiceUrl: links.voiceUrl || null,
        nextCallMs: st.decision.kind === 'not_scheduled' ? st.decision.nextCallMs : null,
        otherCrewLabel: st.decision.kind === 'channel_busy' ? st.decision.otherCrewLabel : null,
      },
      { headers: NO_STORE_HEADERS },
    )
  } catch {
    return NextResponse.json({ canStart: true, state: 'unavailable', voiceUrl: null }, { headers: NO_STORE_HEADERS })
  }
}

const POST_HANDLER = async (request: NextRequest, { params }: Ctx) => {
  const { crewId } = await params
  const id = normalizeCrewId(crewId)
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  const session = await getSession()
  if (!session?.discordId) throw new UnauthorizedError()
  const ctx = await loadCrewCallContext(id)
  if (!ctx.enabled || !ctx.crew || !ctx.crewAllowed) throw new NotFoundError('Starting calls is not available for this crew')
  if (!(await mayStartCrewCall(session.discordId, id, ctx.allowCrewMembers))) throw new ForbiddenError('Crew leads, capos and admins only')

  const limited = await checkKeyedRateLimit('crew-call-start', session.discordId, undefined, { failClosed: true })
  if (!limited.success) return rateLimitResponse(limited)

  const st = await readCrewCallState(ctx, id)
  const links = crewCallLinks(st.voiceChannelId)
  const memberId = await findMemberIdByDiscordId(session.discordId).catch(() => null)
  const minutes = Number.parseInt(ctx.crew.callLength || '', 10)
  const result = await runCrewCallStart(
    {
      decision: st.decision,
      crewId: id,
      crewLabel: ctx.crew.label,
      startedBy: session.discordId,
      startedByLabel: memberId ? `member ${memberId}` : 'a member',
      callLengthMinutes: Number.isFinite(minutes) && minutes > 0 && minutes <= 600 ? minutes : 60,
      voiceUrl: links.voiceUrl,
      liveUrl: links.liveUrl,
      roleId: crewRoleId(ctx.crew),
      settings: ctx.settings,
    },
    buildStartDeps(ctx.crew),
  )
  const body = { ...result, voiceUrl: links.voiceUrl || null }
  const status = result.status === 'started' || result.status === 'preview' ? 200 : result.status === 'discord_failed' ? 502 : 409
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS })
}

export const GET = withErrorHandling(GET_HANDLER)
export const POST = withErrorHandling(POST_HANDLER)
