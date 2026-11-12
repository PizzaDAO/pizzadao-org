import { after, NextResponse } from 'next/server'
import { liveTickForSession } from '@/app/lib/calls/live-announce-command'
import { isRecorderAuthorized } from '@/app/lib/calls/recorder-auth'
import { handleLiveState, liveStateSchema } from '@/app/lib/calls/live-state'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { ValidationError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/calls/recorder/live-state: the recorder's heartbeat for the live call view (who is in
 * the channel, the stream link once found, `ended` at stop). `Authorization: Bearer
 * $RECORDER_API_KEY`. 204 when the live view is switched off (the recorder then stops sending).
 */
export const POST = withErrorHandling(async (request: Request) => {
  if (!isRecorderAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ValidationError('Body must be JSON')
  }
  const parsed = liveStateSchema.safeParse(body)
  if (!parsed.success) throw new ValidationError('Invalid live state')
  const out = await handleLiveState(parsed.data)
  if (out === 'off') return new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
  // The "we're live" announcement and its reminder ride on the heartbeat (each is off unless switched on).
  if (out === 'ok') after(() => liveTickForSession(parsed.data.sessionId))
  return NextResponse.json({}, { headers: { 'Cache-Control': 'no-store' } })
})
