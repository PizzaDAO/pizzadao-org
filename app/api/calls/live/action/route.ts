import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { loadSettings } from '@/app/lib/settings'
import { findLiveSessionById } from '@/app/lib/calls/live-state'
import { liveAccess } from '@/app/lib/calls/live-access'
import { actionSchema, LiveQaError, runLiveAction } from '@/app/lib/calls/live-qa'
import { withErrorHandling } from '@/app/lib/errors/error-response'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store' }

/**
 * POST /api/calls/live/action: a signed-in member asks or votes on a question, votes in a poll; a
 * host also moderates questions, runs polls and sets the stream link. Every action names its call
 * (`sessionId`) and works only while that call is live.
 */
export const POST = withErrorHandling(async (request: Request) => {
  const session = await getSession().catch(() => null)
  if (!session?.discordId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore })
  // JSON only, and same-origin (the page sends JSON from the browser).
  const unsafe = rejectUnsafeWrite(request)
  if (unsafe) return unsafe
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid' }, { status: 400, headers: noStore })
  }
  const parsed = actionSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400, headers: noStore })
  const settings = await loadSettings()
  // The action names its call: it must be live right now (not ended, stale or hidden).
  const live = await findLiveSessionById(settings, parsed.data.sessionId)
  if (!live) return NextResponse.json({ error: 'not-live' }, { status: 409, headers: noStore })
  const access = await liveAccess(session.discordId)
  try {
    const out = await runLiveAction(
      { sessionId: live.sessionId, settings, actor: { discordId: session.discordId, name: session.nick || session.username || null, host: access.host } },
      parsed.data,
    )
    return NextResponse.json({ ok: true, ...out }, { headers: noStore })
  } catch (err) {
    if (err instanceof LiveQaError) return NextResponse.json({ error: err.code }, { status: err.status, headers: noStore })
    throw err
  }
})
