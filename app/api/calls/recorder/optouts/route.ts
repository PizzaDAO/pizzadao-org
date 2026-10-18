import { NextResponse } from 'next/server'
import { isRecorderAuthorized } from '@/app/lib/calls/recorder-auth'
import { listOptOutIds } from '@/app/lib/calls/recordings'
import { withErrorHandling } from '@/app/lib/errors/error-response'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/calls/recorder/optouts — Discord ids that ran /record optout. The
 * worker caches this and never subscribes to these members' audio.
 * `Authorization: Bearer $RECORDER_API_KEY`.
 */
export const GET = withErrorHandling(async (request: Request) => {
  if (!isRecorderAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ discordIds: await listOptOutIds() }, { headers: { 'Cache-Control': 'no-store' } })
})
