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

  const completion = await submitMissionCompletion(
    session.discordId,
    missionId,
    evidence,
    notes,
    memberId
  )

  // Missions with an automatic verifier are checked right away (e.g. the
  // #show-and-tell message link). A pass approves (or holds for a release);
  // anything else leaves the submission PENDING for a reviewer.
  let status: string = completion.status
  let levelsPaid: number[] = []
  if (missionVerifiersEnabled() && completion.mission.verifierKey) {
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
        autoVerify: completion.mission.autoVerify,
      },
    },
    levelsPaid,
  })
}

export const POST = withErrorHandling(POST_HANDLER)
