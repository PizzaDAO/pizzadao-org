import { after, NextResponse } from 'next/server'
import { isRecorderAuthorized } from '@/app/lib/calls/recorder-auth'
import { parseIngestPayload } from '@/app/lib/calls/ingest-schema'
import { generateAndStoreSummary, ingestRecording } from '@/app/lib/calls/recordings'
import { transcribeRecording } from '@/app/lib/calls/transcribe'
import { draftFollowUpsForRecording } from '@/app/lib/followups/draft'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { ValidationError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// The summary runs after the response, inside this function's time budget.
export const maxDuration = 300

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
  const { id, duplicate, keys, summarize, transcribe } = await ingestRecording(payload)
  // Summarize after responding so the worker is not kept waiting on the model.
  // Transcription (which then summarizes) supersedes a chat-only summary.
  if (summarize && !transcribe) {
    after(async () => {
      try {
        const ok = await generateAndStoreSummary(id, { onlyIfEmpty: true })
        // Follow-up drafts (drafts only, once per call; the followups cron retries if this misses).
        if (ok) await draftFollowUpsForRecording(id, { budgetMs: 90_000 })
      } catch (err) {
        console.error('[calls/ingest] summary failed:', err instanceof Error ? err.message : err)
      }
    })
  }
  // No spoken transcript from the worker: transcribe the speaker tracks here (then summarize). The cron retries failures.
  if (transcribe) after(() => transcribeRecording(id).catch((err) => console.error('[calls/ingest] transcription failed:', err instanceof Error ? err.message : err)))
  // `keys` = the R2 objects the stored row references; the worker prunes anything else under the session prefix.
  return NextResponse.json({ id, duplicate, keys }, { status: duplicate ? 200 : 201 })
})
