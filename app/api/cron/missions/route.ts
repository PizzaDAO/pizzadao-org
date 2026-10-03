import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/app/lib/cron-auth'
import { internalError } from '@/app/lib/errors/error-response'
import { runNightlyMissions } from '@/app/lib/mission-verify/nightly'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// The run is time-boxed below this (MISSIONS_CRON_BUDGET_MS, default 240 s)
// and resumes in the next vercel.json slot.
export const maxDuration = 300

/**
 * GET /api/cron/missions — the nightly mission verification run (Vercel Cron,
 * `Authorization: Bearer $CRON_SECRET`). See app/lib/mission-verify/nightly.ts.
 * Dry (records what would happen, approves and pays nothing) while
 * MISSION_VERIFIERS_ENABLED is off.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const result = await runNightlyMissions()
    console.log('[cron/missions]', JSON.stringify({ ...result, stats: undefined }))
    return NextResponse.json(result)
  } catch (err) {
    return internalError(err, 'cron/missions', 'Mission run failed')
  }
}
