import { NextResponse } from 'next/server'
import { isRecorderAuthorized } from '@/app/lib/calls/recorder-auth'
import { parseIngestPayload } from '@/app/lib/calls/ingest-schema'
import { ingestRecording } from '@/app/lib/calls/recordings'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { ValidationError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/calls/recorder/ingest — the recorder worker reports a finished
 * call (metadata + R2 keys; audio itself goes straight to R2).
 * `Authorization: Bearer $RECORDER_API_KEY`. Idempotent on sessionId.
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
  const payload = parseIngestPayload(body)
  const { id, duplicate, keys } = await ingestRecording(payload)
  // `keys` = the R2 objects the stored row references; the worker prunes anything else under the session prefix.
  return NextResponse.json({ id, duplicate, keys }, { status: duplicate ? 200 : 201 })
})
