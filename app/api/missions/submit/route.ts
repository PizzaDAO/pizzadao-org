import { after, NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { submitMissionCompletion } from '@/app/lib/missions'
import { requireOnboarded } from '@/app/lib/economy'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { UnauthorizedError, ValidationError } from '@/app/lib/errors/api-errors'
import { invalidateProgressCache } from '@/app/lib/mission-cache'
import { fetchMemberIdByDiscordId } from '@/app/lib/sheets/member-repository'
import { runVerifiers } from '@/app/lib/mission-verify/engine'
import { missionVerifiersEnabled } from '@/app/lib/mission-verify/policy'
import { announceMissionResults } from '@/app/lib/mission-verify/notify'
import { reviewCardsEnabled, syncReviewCardsFor } from '@/app/lib/mission-verify/review-cards'
import { isPrecheckedMission, precheckProof, storeCheckResult } from '@/app/lib/mission-verify/precheck'
import { prisma } from '@/app/lib/db'
import { checkKeyedRateLimit, rateLimitResponse } from '@/app/lib/rate-limit'

export const runtime = 'nodejs'

// POST - Submit a mission completion
const POST_HANDLER = async (request: NextRequest) => {
  const session = await getSession()

  if (!session?.discordId) {
    throw new UnauthorizedError()
  }

  await requireOnboarded(session.discordId)

  const body = await request.json()
  // memberId is derived from the session, never from the body (it drives
  // auto-verification against the member's sheet data).
  const { missionId, evidence, notes } = body
  const memberId = (await fetchMemberIdByDiscordId(session.discordId).catch(() => null)) ?? undefined

  if (!missionId || typeof missionId !== 'number') {
    throw new ValidationError('Valid mission ID required')
  }
  if (evidence !== undefined && evidence !== null && (typeof evidence !== 'string' || evidence.length > 2000)) {
    throw new ValidationError('Evidence must be a link or a short text')
  }

  // Submissions fetch proof previews / pre-checks from third parties: 10 an hour per member.
  const rl = await checkKeyedRateLimit('missions-submit', session.discordId)
  if (!rl.success) return rateLimitResponse(rl)

  // Semi-automatic missions (Phase 4): pre-check the proof link before writing
  // anything. Not the right kind of link -> 400 with the hint, no row (the
  // member just fixes it). Otherwise the checks go on the PENDING row for the
  // reviewer. Missions without a verifier only get a link preview.
  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    select: { verifierKey: true, verifierParams: true, isActive: true },
  })
  const precheck =
    mission?.isActive && isPrecheckedMission(mission.verifierKey)
      ? await precheckProof({ discordId: session.discordId, memberId: memberId ?? null, mission, evidence })
      : {}
  if (precheck.reject) {
    throw new ValidationError(precheck.reject.hint ? `${precheck.reject.reason}. ${precheck.reject.hint}` : precheck.reject.reason, 'evidence')
  }

  const completion = await submitMissionCompletion(
    session.discordId,
    missionId,
    evidence,
    notes,
    memberId
  )

  if (precheck.checkResult) {
    await storeCheckResult(completion.id, precheck.checkResult, !!mission?.verifierKey)
  }

  // Missions with an automatic verifier are checked right away (e.g. the
  // #show-and-tell message link). A pass approves (or holds for a release);
  // anything else leaves the submission PENDING for a reviewer.
  let status: string = completion.status
  let levelsPaid: number[] = []
  if (missionVerifiersEnabled() && completion.mission.verifierKey && !isPrecheckedMission(completion.mission.verifierKey)) {
    try {
      const report = await runVerifiers(session.discordId, {
        trigger: 'submit',
        missionIds: [missionId],
        memberId: memberId ?? null,
      })
      const c = report.checks.find((x) => x.missionId === missionId)
      if (c?.outcome === 'approved') status = 'APPROVED'
      levelsPaid = report.levelsPaid
      if (report.levelsPaid.length) {
        const discordId = session.discordId
        after(() =>
          announceMissionResults({ discordId, trigger: 'submit', approvedTitles: [completion.mission.title], levelsPaid }).then(() => undefined),
        )
      }
    } catch (err) {
      // The submission stands (PENDING); a reviewer or a later check decides.
      console.error('[missions/submit] verifier run failed:', err)
    }
  }

  // Invalidate cached progress for this user
  invalidateProgressCache(session.discordId)

  // Still waiting for a human (submission, resubmission, or a hold): post the
  // Discord review card in #work, after the response. Independent of
  // MISSION_VERIFIERS_ENABLED; gated by MISSION_REVIEW_CARDS_ENABLED.
  if (status !== 'APPROVED' && reviewCardsEnabled()) {
    const discordId = session.discordId
    after(() => syncReviewCardsFor(discordId, [missionId]).then(() => undefined))
  }

  return NextResponse.json({
    success: true,
    completion: {
      id: completion.id,
      missionId: completion.missionId,
      status,
      submittedAt: completion.submittedAt.toISOString(),
      mission: {
        title: completion.mission.title,
        level: completion.mission.level,
      },
    },
    levelsPaid,
  })
}

export const POST = withErrorHandling(POST_HANDLER)
