import { NextResponse } from 'next/server'
import { isRecorderAuthorized } from '@/app/lib/calls/recorder-auth'
import { liveRequestSchema } from '@/app/lib/calls/live-items'
import { handleLiveRequest } from '@/app/lib/calls/live-run'
import { handlePlayOutRequest } from '@/app/lib/calls/play-out-run'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { ValidationError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Transcription (<= 60 s) plus one model call (<= 35 s).
export const maxDuration = 120

/**
 * POST /api/calls/recorder/live-chunk — the recorder sends speech bursts (R2 keys under
 * calls/<sessionId>/live/) or prefixed chat lines during a call; the answer is the confirmation to
 * post in the call chat: `{ messages: string[] }` (usually empty). `Authorization: Bearer
 * $RECORDER_API_KEY`. Off unless calls.liveActionItemsEnabled / calls.chatActionItemsEnabled and the
 * crew allowlist say otherwise (see app/lib/calls/live-run.ts).
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
  const parsed = liveRequestSchema.safeParse(body)
  if (!parsed.success) throw new ValidationError('Invalid live chunk')
  if (parsed.data.command === 'play-out') {
    const r = await handlePlayOutRequest(parsed.data)
    if (r.playOut) console.log(`[calls/live] ${parsed.data.sessionId} play-out command`)
    return NextResponse.json({ messages: [], playOut: r.playOut }, { headers: { 'Cache-Control': 'no-store' } })
  }
  const out = await handleLiveRequest(parsed.data)
  if (out.reason) console.log(`[calls/live] ${parsed.data.sessionId} seq=${parsed.data.seq ?? '-'} ${out.reason}`)
  return NextResponse.json({ messages: out.messages }, { headers: { 'Cache-Control': 'no-store' } })
})
