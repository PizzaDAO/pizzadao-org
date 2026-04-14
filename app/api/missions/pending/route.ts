import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { getPendingSubmissions } from '@/app/lib/missions'
import { hasAnyRole } from '@/app/lib/discord'
import { ADMIN_ROLE_IDS } from '@/app/ui/constants'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { UnauthorizedError, ForbiddenError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'

// GET - List pending mission submissions (admin only)
const GET_HANDLER = async () => {
  const session = await getSession()

  if (!session?.discordId) {
    throw new UnauthorizedError()
  }

  const isAdmin = await hasAnyRole(session.discordId, ADMIN_ROLE_IDS)
  if (!isAdmin) {
    throw new ForbiddenError('Only admins can view pending submissions')
  }

  const pending = await getPendingSubmissions()

  return NextResponse.json({
    submissions: pending.map(p => ({
      id: p.id,
      missionId: p.missionId,
      discordId: p.discordId,
      memberId: p.memberId,
      evidence: p.evidence,
      notes: p.notes,
      submittedAt: p.submittedAt.toISOString(),
      mission: {
        title: p.mission.title,
        level: p.mission.level,
        index: p.mission.index,
        description: p.mission.description,
      },
    })),
  })
}

export const GET = withErrorHandling(GET_HANDLER)
