import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/app/lib/cron-auth'
import { toggleEnabled } from '@/app/lib/settings/toggles'
import { internalError } from '@/app/lib/errors/error-response'
import { runTraineeNicks } from '@/app/lib/trainee-nick-run'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * GET /api/cron/trainee-nicks — every 10 minutes (Vercel Cron,
 * `Authorization: Bearer $CRON_SECRET`). Names Discord members who joined after
 * TRAINEE_NICK_SINCE and haven't signed up "Pizza Trainee" (plus the Pizza Noob
 * role) and removes Pizza Noob after missions Level 2. See
 * app/lib/trainee-nick-run.ts and plans/anchovy-52918.md.
 *
 * Dry run (no Discord writes) unless the setting onboarding.traineeNickEnabled (or TRAINEE_NICK_ENABLED=true) is on; `?dryRun=1`
 * forces a dry run even then.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const dryRun =
    !(await toggleEnabled('onboarding.traineeNickEnabled')) || request.nextUrl.searchParams.get('dryRun') === '1'
  try {
    const result = await runTraineeNicks({ dryRun })
    console.log('[cron/trainee-nicks]', JSON.stringify(result))
    return NextResponse.json(result)
  } catch (err) {
    return internalError(err, 'cron/trainee-nicks', 'Trainee nickname run failed')
  }
}
