import { after, NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from '@/app/lib/errors/api-errors'
import { rejectUnsafeWrite } from '@/app/lib/admin-guard'
import { checkKeyedRateLimit, rateLimitResponse } from '@/app/lib/rate-limit'
import { invalidateProgressCache } from '@/app/lib/mission-cache'
import { invalidateProfileSummaryForDiscord } from '@/app/lib/profile-summary-invalidate'
import { announceMissionResults } from '@/app/lib/mission-verify/notify'
import { reviewCardsEnabled, syncReviewCard } from '@/app/lib/mission-verify/review-cards'
import { listPanelMissions, manualApproveMission, resolveTargetDiscordId } from '@/app/lib/mission-manual-approve'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'private, no-store' }

// GET ?memberId= : the "Missions (admin)" panel data. Reviewers only; anyone else (and the member
// themself) gets an empty list, never mission data. Per-level visibility follows canReviewMission.
const GET_HANDLER = async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.discordId) throw new UnauthorizedError()
  const target = await resolveTargetDiscordId({ memberId: new URL(request.url).searchParams.get('memberId') })
  const missions = target ? await listPanelMissions(session.discordId, target) : []
  return NextResponse.json({ missions }, { headers: NO_STORE })
}

// POST { memberId | discordId, missionId, note }: mark a mission complete for a member without a
// submission, through the normal approveMission path (rewards paid once, audit event via "manual").
// Same reviewer rule as a normal review: admin roles + DPR / Pizza Capo / Pepperoni Mafia for L1-L7,
// DPR only for L8, nobody on their own missions. Permission is re-checked server-side.
const POST_HANDLER = async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.discordId) throw new UnauthorizedError()
  const reviewerId = session.discordId

  const bad = rejectUnsafeWrite(request)
  if (bad) return bad

  const body = await request.json().catch(() => null)
  const missionId = body?.missionId
  if (!Number.isInteger(missionId) || missionId < 1) throw new ValidationError('Valid mission ID required', 'missionId')
  if (typeof body?.note !== 'string') throw new ValidationError('A note is required', 'note')

  const targetDiscordId = await resolveTargetDiscordId(body ?? {})
  if (!targetDiscordId) throw new NotFoundError('Member')
  if (targetDiscordId === reviewerId) throw new ForbiddenError("You can't approve your own missions")

  const rl = await checkKeyedRateLimit('missions-manual-approve', reviewerId, undefined, { failClosed: true })
  if (!rl.success) return rateLimitResponse(rl)

  const result = await manualApproveMission({ reviewerId, targetDiscordId, missionId, note: body.note })

  if (!result.alreadyApproved) {
    invalidateProgressCache(result.discordId)
    await invalidateProfileSummaryForDiscord(result.discordId)
    if (result.levelsPaid.length) {
      after(() =>
        announceMissionResults({ discordId: result.discordId, trigger: 'review', approvedTitles: [], levelsPaid: result.levelsPaid }).then(
          () => undefined,
        ),
      )
    }
    if (await reviewCardsEnabled()) after(() => syncReviewCard(result.completionId).then(() => undefined))
  }

  return NextResponse.json(
    { success: true, alreadyApproved: result.alreadyApproved, completionId: result.completionId, levelsPaid: result.levelsPaid },
    { headers: NO_STORE },
  )
}

export const GET = withErrorHandling(GET_HANDLER)
export const POST = withErrorHandling(POST_HANDLER)
