import { after, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { requireOnboarded } from '@/app/lib/economy'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { UnauthorizedError } from '@/app/lib/errors/api-errors'
import { checkKeyedRateLimit, rateLimitResponse } from '@/app/lib/rate-limit'
import { runVerifiers } from '@/app/lib/mission-verify/engine'
import { announceMissionResults } from '@/app/lib/mission-verify/notify'
import { buildMissionsView } from '@/app/lib/mission-verify/view'
import { getMissionsOverview } from '@/app/lib/missions-overview'

export const runtime = 'nodejs'

// POST - "Check my progress" on /missions: run the automatic mission
// verifiers for the signed-in member (plans/mission-verification.md §3.4).
// Rate limited per member: 1 per 30 s and 30 per day. While
// MISSION_VERIFIERS_ENABLED is off it is a dry run (progress and hints only).
const POST_HANDLER = async () => {
  const session = await getSession()
  if (!session?.discordId) throw new UnauthorizedError()
  const discordId = session.discordId
  await requireOnboarded(discordId)

  for (const name of ['missions-check', 'missions-check-daily'] as const) {
    const rl = await checkKeyedRateLimit(name, discordId)
    if (!rl.success) return rateLimitResponse(rl)
  }

  const report = await runVerifiers(discordId, { trigger: 'on_demand' })
  const view = buildMissionsView(await getMissionsOverview(discordId), report)

  if (!report.dryRun && (report.levelsPaid.length || report.approved.length)) {
    after(() =>
      announceMissionResults({ discordId, trigger: 'on_demand', approvedTitles: view.approvedTitles, levelsPaid: report.levelsPaid }).then(
        () => undefined,
      ),
    )
  }

  return NextResponse.json({
    enabled: report.enabled,
    approved: report.approved,
    held: report.held,
    reopened: report.reopened,
    levelsPaid: report.levelsPaid,
    currentLevel: view.currentLevel,
    missions: view.missions.map((m) => ({
      missionId: m.missionId,
      level: m.level,
      state: m.state,
      holdReason: m.holdReason ?? null,
      justApproved: !!m.justApproved,
      check: m.check ?? null,
    })),
  })
}

export const POST = withErrorHandling(POST_HANDLER)
