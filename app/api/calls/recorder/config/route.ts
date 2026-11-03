import { NextResponse } from 'next/server'
import { isRecorderAuthorized } from '@/app/lib/calls/recorder-auth'
import { buildRecorderConfig } from '@/app/lib/calls/recorder-config'
import { withErrorHandling } from '@/app/lib/errors/error-response'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/calls/recorder/config — the recorder worker reads the admin settings it honours
 * (read-only, recorder-facing values only). `Authorization: Bearer $RECORDER_API_KEY`.
 */
export const GET = withErrorHandling(async (request: Request) => {
  if (!isRecorderAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json(await buildRecorderConfig(), { headers: { 'Cache-Control': 'no-store' } })
})
