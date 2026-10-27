import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/app/lib/cron-auth'
import { internalError } from '@/app/lib/errors/error-response'
import { generateAndStoreSummary } from '@/app/lib/calls/recordings'
import { listNeedingSummary, listPendingTranscription, transcribeRecording, USED_OPENAI } from '@/app/lib/calls/transcribe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * GET /api/cron/call-transcripts — every 15 minutes (Vercel Cron, Bearer CRON_SECRET). Transcribes
 * the oldest recording from the last 14 days that still has no spoken transcript (per-speaker tracks
 * via OpenAI), then summarizes it. The run stops after the first recording that actually called
 * OpenAI (so it stays inside the function limit and the cost per run is bounded); recordings that
 * need no work are skipped. Afterwards it finishes summaries of transcribed calls whose run died
 * mid-summary. Does nothing without OPENAI_API_KEY.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!process.env.OPENAI_API_KEY?.trim()) return NextResponse.json({ skipped: 'no-openai-key' })
  try {
    const started = Date.now()
    const usage = { calls: 0 }
    const results: Array<{ id: string; outcome: string }> = []
    for (const rec of await listPendingTranscription(14, 10)) {
      // Never begin another recording late in the run: the budgets inside transcribeRecording are measured from `started`.
      if (Date.now() - started > 30_000) break
      const outcome = await transcribeRecording(rec.id, { startedMs: started, usage, log: (m) => console.warn('[cron/call-transcripts]', m) })
      results.push({ id: rec.id, outcome })
      // `usage` catches runs that paid for OpenAI but ended 'busy' / 'already-had-speech'.
      if (usage.calls > 0 || USED_OPENAI.has(outcome)) break
    }
    // Only with time to spare: a summary is one model call (30-90 s).
    if (Date.now() - started < 150_000) {
      for (const rec of await listNeedingSummary()) {
        const ok = await generateAndStoreSummary(rec.id, { onlyIfEmpty: true, unlessEdited: true })
        results.push({ id: rec.id, outcome: ok ? 'summarized' : 'summary-skipped' })
        if (Date.now() - started > 150_000) break
      }
    }
    console.log('[cron/call-transcripts]', JSON.stringify(results))
    return NextResponse.json({ results })
  } catch (err) {
    return internalError(err, 'cron/call-transcripts', 'Call transcription cron failed')
  }
}
