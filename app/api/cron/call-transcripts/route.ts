import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/app/lib/cron-auth'
import { internalError } from '@/app/lib/errors/error-response'
import { listPendingTranscription, transcribeRecording } from '@/app/lib/calls/transcribe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * GET /api/cron/call-transcripts — every 15 minutes (Vercel Cron, Bearer CRON_SECRET). Transcribes
 * the oldest recording from the last 14 days that still has no spoken transcript (per-speaker tracks
 * via OpenAI), then summarizes it. One real transcription per run keeps it inside the function limit;
 * recordings that need no work are skipped without using the run. Does nothing without OPENAI_API_KEY.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!process.env.OPENAI_API_KEY?.trim()) return NextResponse.json({ skipped: 'no-openai-key' })
  try {
    const results: Array<{ id: string; outcome: string }> = []
    for (const rec of await listPendingTranscription(14, 10)) {
      const outcome = await transcribeRecording(rec.id, { log: (m) => console.warn('[cron/call-transcripts]', m) })
      results.push({ id: rec.id, outcome })
      if (outcome === 'transcribed' || outcome === 'failed') break
    }
    console.log('[cron/call-transcripts]', JSON.stringify(results))
    return NextResponse.json({ results })
  } catch (err) {
    return internalError(err, 'cron/call-transcripts', 'Call transcription cron failed')
  }
}
