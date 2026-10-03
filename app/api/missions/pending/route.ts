import { NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { getPendingSubmissions, splitReviewHistory } from '@/app/lib/missions'
import { missionReviewScope } from '@/app/lib/mission-review-access'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { UnauthorizedError, ForbiddenError } from '@/app/lib/errors/api-errors'
import { fetchMemberByDiscordId } from '@/app/lib/sheets/member-repository'

export const runtime = 'nodejs'

// GET - List the pending mission submissions this reviewer may review
// (L1–L7 for admins / DPR / Pizza Capo / Pepperoni Mafia, L8 for DPR only),
// excluding their own.
const GET_HANDLER = async () => {
  const session = await getSession()

  if (!session?.discordId) {
    throw new UnauthorizedError()
  }

  const canReviewLevel = await missionReviewScope(session.discordId)
  if (!canReviewLevel) {
    throw new ForbiddenError('Only mission reviewers can view pending submissions')
  }

  const pending = (await getPendingSubmissions()).filter(
    p => canReviewLevel(p.mission.level) && p.discordId !== session.discordId,
  )

  // Resolve Discord IDs to member names
  const uniqueDiscordIds = [...new Set(pending.map(p => p.discordId))]
  const memberLookups = await Promise.all(
    uniqueDiscordIds.map(async (did) => {
      const member = await fetchMemberByDiscordId(did)
      return [did, member?.name ?? null] as const
    })
  )
  const nameMap = new Map(memberLookups)

  return NextResponse.json({
    submissions: pending.map(p => {
      const { memberNotes, history } = splitReviewHistory(p.notes)
      return {
        id: p.id,
        missionId: p.missionId,
        discordId: p.discordId,
        memberId: p.memberId,
        memberName: nameMap.get(p.discordId) ?? null,
        evidence: p.evidence,
        notes: memberNotes,
        // Earlier rejections of this same submission (it was resubmitted).
        reviewHistory: history,
        attempt: history.length + 1,
        submittedAt: p.submittedAt.toISOString(),
        mission: {
          title: p.mission.title,
          level: p.mission.level,
          index: p.mission.index,
          description: p.mission.description,
        },
      }
    }),
  })
}

export const GET = withErrorHandling(GET_HANDLER)
