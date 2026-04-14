import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { approveMission, rejectMission } from '@/app/lib/missions'
import { hasAnyRole } from '@/app/lib/discord'
import { ADMIN_ROLE_IDS } from '@/app/ui/constants'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { UnauthorizedError, ForbiddenError, ValidationError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'

// POST - Approve or reject a mission submission
const POST_HANDLER = async (request: NextRequest) => {
  const session = await getSession()

  if (!session?.discordId) {
    throw new UnauthorizedError()
  }

  const isAdmin = await hasAnyRole(session.discordId, ADMIN_ROLE_IDS)
  if (!isAdmin) {
    throw new ForbiddenError('Only admins can review mission submissions')
  }

  const body = await request.json()
  const { completionId, action, reviewNote } = body

  if (!completionId || typeof completionId !== 'number') {
    throw new ValidationError('Valid completion ID required')
  }

  if (action !== 'approve' && action !== 'reject') {
    throw new ValidationError('Action must be "approve" or "reject"')
  }

  let result
  if (action === 'approve') {
    result = await approveMission(session.discordId, completionId, reviewNote)
  } else {
    result = await rejectMission(session.discordId, completionId, reviewNote)
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
