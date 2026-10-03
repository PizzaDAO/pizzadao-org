import { after, NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { approveMission, rejectMission, getCompletionForReview } from '@/app/lib/missions'
import { canReviewMission } from '@/app/lib/mission-review-access'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { UnauthorizedError, ForbiddenError, ValidationError, NotFoundError } from '@/app/lib/errors/api-errors'
import { invalidateProgressCache } from '@/app/lib/mission-cache'
import { announceMissionResults } from '@/app/lib/mission-verify/notify'
import { reviewCardsEnabled, syncReviewCard } from '@/app/lib/mission-verify/review-cards'

export const runtime = 'nodejs'

// POST - Approve or reject a mission submission.
// Reviewers: the admin roles + Dread Pizza Roberts, Pizza Capo and Pepperoni
// Mafia for L1–L7; Dread Pizza Roberts only for L8 (canReviewMission).
// Nobody reviews their own submission.
const POST_HANDLER = async (request: NextRequest) => {
  const session = await getSession()

  if (!session?.discordId) {
    throw new UnauthorizedError()
  }

  const body = await request.json()
  const { completionId, action, reviewNote } = body

  if (!completionId || typeof completionId !== 'number') {
    throw new ValidationError('Valid completion ID required')
  }

  if (action !== 'approve' && action !== 'reject') {
    throw new ValidationError('Action must be "approve" or "reject"')
  }

  const target = await getCompletionForReview(completionId)
  if (!target) {
    throw new NotFoundError('Mission completion')
  }
  if (!(await canReviewMission(session.discordId, target.level))) {
    throw new ForbiddenError(`You can't review Level ${target.level} mission submissions`)
  }
  if (target.discordId === session.discordId) {
    throw new ForbiddenError("You can't review your own mission submission")
  }

  if (action === 'approve' && target.noteRequired && !(typeof reviewNote === 'string' && reviewNote.trim().length >= 3)) {
    // A member-submitted "Invite a friend" with no tracked referral (D4 manual path).
    throw new ValidationError('Add a review note: who did they invite, and how did you check?')
  }

  let result
  if (action === 'approve') {
    // Also "releases" an auto-verified completion that was held for a human (D9).
    const approved = await approveMission(session.discordId, completionId, reviewNote)
    const levelsPaid = approved.levelsPaid ?? []
    if (levelsPaid.length) {
      after(() =>
        announceMissionResults({ discordId: approved.discordId, trigger: 'review', approvedTitles: [], levelsPaid }).then(() => undefined),
      )
    }
    result = approved
  } else {
    result = await rejectMission(session.discordId, completionId, reviewNote)
  }

  // Invalidate cached progress for the submission's owner
  invalidateProgressCache(result.discordId)

  // Keep the Discord review card in sync (outcome, who, when; buttons
  // disabled). After the response, best effort: never blocks this request.
  if (reviewCardsEnabled()) {
    after(() => syncReviewCard(completionId).then(() => undefined))
  }

  return NextResponse.json({
    success: true,
    completion: {
      id: result.id,
      status: result.status,
      reviewedBy: result.reviewedBy,
      reviewedAt: result.reviewedAt?.toISOString(),
    },
  })
}

export const POST = withErrorHandling(POST_HANDLER)
