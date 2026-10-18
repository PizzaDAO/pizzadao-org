import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/app/lib/cron-auth'
import { internalError } from '@/app/lib/errors/error-response'
import { sweepExpiredAudio } from '@/app/lib/calls/retention'
import { r2Configured } from '@/app/lib/calls/r2'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * GET /api/cron/call-audio-retention — daily (Vercel Cron, `Authorization:
 * Bearer $CRON_SECRET`). Deletes call audio from R2 once the recording ended
 * more than RECORDING_AUDIO_RETENTION_DAYS (default 90) ago.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!r2Configured()) return NextResponse.json({ status: 'skipped', reason: 'R2 not configured' })
  try {
    const result = await sweepExpiredAudio()
    console.log('[cron/call-audio-retention]', JSON.stringify(result))
    return NextResponse.json({ status: 'finished', ...result })
  } catch (err) {
    return internalError(err, 'cron/call-audio-retention', 'Audio retention sweep failed')
  }
}
