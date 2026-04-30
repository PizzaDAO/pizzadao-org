import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { submitMissionCompletion } from '@/app/lib/missions'
import { requireOnboarded } from '@/app/lib/economy'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { UnauthorizedError, ValidationError } from '@/app/lib/errors/api-errors'
import { invalidateProgressCache } from '@/app/lib/mission-cache'

export const runtime = 'nodejs'

// POST - Submit a mission completion
const POST_HANDLER = async (request: NextRequest) => {
  const session = await getSession()

  if (!session?.discordId) {
    throw new UnauthorizedError()
  }

  await requireOnboarded(session.discordId)

  const body = await request.json()
  const { missionId, evidence, notes, memberId } = body

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

  // Invalidate cached progress for this user
  invalidateProgressCache(session.discordId)

  return NextResponse.json({
    success: true,
    completion: {
      id: completion.id,
      missionId: completion.missionId,
      status: completion.status,
      submittedAt: completion.submittedAt.toISOString(),
      mission: {
        title: completion.mission.title,
        level: completion.mission.level,
        autoVerify: completion.mission.autoVerify,
      },
    },
  })
}

export const POST = withErrorHandling(POST_HANDLER)
