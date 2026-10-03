import { after, NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { approveMission, getCompletionForReview } from '@/app/lib/missions'
import { canReviewMission } from '@/app/lib/mission-review-access'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { UnauthorizedError, ValidationError } from '@/app/lib/errors/api-errors'
import { invalidateProgressCache } from '@/app/lib/mission-cache'
import { announceMissionResults } from '@/app/lib/mission-verify/notify'
import { reviewCardsEnabled, syncReviewCard } from '@/app/lib/mission-verify/review-cards'
import { BULK_APPROVE_MAX, bulkApprove, parseBulkIds } from '@/app/lib/mission-verify/bulk-review'
import { checkKeyedRateLimit, rateLimitResponse } from '@/app/lib/rate-limit'

export const runtime = 'nodejs'

// POST { completionIds: number[], reviewNote?: string } - approve several
// pending submissions at once (web review panel). Same auth and the same
// race-safe approveMission per item as POST /api/missions/review: reviewer
// roles per level (L8 = Dread Pizza Roberts only), never your own, each
// level paid once. Returns one outcome per id.
const POST_HANDLER = async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.discordId) throw new UnauthorizedError()
  const reviewerId = session.discordId

  const body = await request.json().catch(() => null)
  const ids = parseBulkIds(body?.completionIds)
  if (!ids) throw new ValidationError(`completionIds must be 1-${BULK_APPROVE_MAX} completion IDs`)
  const note = typeof body?.reviewNote === 'string' ? body.reviewNote.slice(0, 500) : undefined

  const rl = await checkKeyedRateLimit('missions-bulk-review', reviewerId)
  if (!rl.success) return rateLimitResponse(rl)

  const results = await bulkApprove(reviewerId, ids, { note }, {
    target: getCompletionForReview,
    canReview: (id, level) => canReviewMission(id, level),
    approve: async (by, id, n) => {
      const r = await approveMission(by, id, n)
      return { discordId: r.discordId, levelsPaid: r.levelsPaid ?? [] }
    },
  })

  const approved = results.filter((r) => r.outcome === 'approved')
  for (const r of approved) if (r.discordId) invalidateProgressCache(r.discordId)
  if (approved.length) {
    after(async () => {
      for (const r of approved) {
        if (r.discordId && r.levelsPaid?.length) {
          await announceMissionResults({ discordId: r.discordId, trigger: 'review', approvedTitles: [], levelsPaid: r.levelsPaid }).catch(() => undefined)
        }
        if (reviewCardsEnabled()) await syncReviewCard(r.id)
      }
    })
  }

  return NextResponse.json({
    success: true,
    approved: approved.length,
    results: results.map(({ id, outcome }) => ({ id, outcome })),
  })
}

export const POST = withErrorHandling(POST_HANDLER)
