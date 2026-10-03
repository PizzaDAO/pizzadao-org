import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/app/lib/session'
import { fetchMemberIdByDiscordId } from '@/app/lib/sheets/member-repository'
import {
  getCelebrationState,
  updateCelebrationState,
  claimProfileCompletedCelebration,
  claimLevelCelebration,
} from '@/app/lib/celebration'
import { getCurrentLevel } from '@/app/lib/missions'
import { withErrorHandling } from '@/app/lib/errors/error-response'
import { UnauthorizedError, NotFoundError, ValidationError } from '@/app/lib/errors/api-errors'

export const runtime = 'nodejs'

/**
 * GET /api/missions/celebration
 *
 * Returns the celebration state for the logged-in member. Lazy-creates the
 * row if missing.
 */
const GET_HANDLER = async () => {
  const session = await getSession()
  if (!session?.discordId) {
    throw new UnauthorizedError()
  }

  const memberId = await fetchMemberIdByDiscordId(session.discordId)
  if (!memberId) {
    // No member row yet — return a neutral default. Don't lazy-create extras
    // for a non-onboarded user.
    return NextResponse.json({
      memberId: null,
      lastCelebratedLevel: 0,
      firstMissionCelebratedAt: null,
      vouchPromptShownAt: null,
      profileCompletedCelebratedAt: null,
    }, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  }

  const state = await getCelebrationState(memberId)
  return NextResponse.json(state, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

/**
 * POST /api/missions/celebration
 *
 * Body: { lastCelebratedLevel?: number, firstMissionCelebrated?: boolean,
 *         vouchPromptDismissed?: boolean, profileCompleted?: boolean,
 *         claimLevelUp?: boolean }
 *
 * Idempotent — `lastCelebratedLevel` is monotonic and the boolean fields
 * only flip null -> timestamp once.
 *
 * `profileCompleted: true` (jalapeno-34126) atomically claims the one-shot
 * profile-complete celebration. The response then carries
 * `profileCompletedClaimed: boolean` — true only for the single request that
 * flipped the flag, so the client shows the pop-up at most once ever.
 */
const POST_HANDLER = async (request: NextRequest) => {
  const session = await getSession()
  if (!session?.discordId) {
    throw new UnauthorizedError()
  }

  const memberId = await fetchMemberIdByDiscordId(session.discordId)
  if (!memberId) {
    throw new NotFoundError('Member profile')
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) ?? {}
  } catch {
    body = {}
  }

  const patch: {
    lastCelebratedLevel?: number
    firstMissionCelebrated?: boolean
    vouchPromptDismissed?: boolean
  } = {}

  if (body.lastCelebratedLevel !== undefined) {
    if (typeof body.lastCelebratedLevel !== 'number' || !Number.isInteger(body.lastCelebratedLevel) || body.lastCelebratedLevel < 0) {
      throw new ValidationError('lastCelebratedLevel must be a non-negative integer')
    }
    patch.lastCelebratedLevel = body.lastCelebratedLevel
  }
  if (body.firstMissionCelebrated !== undefined) {
    if (typeof body.firstMissionCelebrated !== 'boolean') {
      throw new ValidationError('firstMissionCelebrated must be a boolean')
    }
    patch.firstMissionCelebrated = body.firstMissionCelebrated
  }
  if (body.vouchPromptDismissed !== undefined) {
    if (typeof body.vouchPromptDismissed !== 'boolean') {
      throw new ValidationError('vouchPromptDismissed must be a boolean')
    }
    patch.vouchPromptDismissed = body.vouchPromptDismissed
  }
  if (body.profileCompleted !== undefined && typeof body.profileCompleted !== 'boolean') {
    throw new ValidationError('profileCompleted must be a boolean')
  }
  if (body.claimLevelUp !== undefined && typeof body.claimLevelUp !== 'boolean') {
    throw new ValidationError('claimLevelUp must be a boolean')
  }
  const profileCompletedClaimed =
    body.profileCompleted === true ? await claimProfileCompletedCelebration(memberId) : undefined

  // `claimLevelUp: true` claims the level-up celebration for the member's
  // current level as computed here on the server (not a client-sent number),
  // so a level-up approved while they were away is celebrated exactly once.
  let levelUp: { levelUpClaimed: boolean; level: number } | undefined
  if (body.claimLevelUp === true) {
    const level = await getCurrentLevel(session.discordId)
    levelUp = { levelUpClaimed: level >= 2 && (await claimLevelCelebration(memberId, level)), level }
  }

  const state = await updateCelebrationState(memberId, patch)
  const payload = {
    ...state,
    ...(profileCompletedClaimed === undefined ? {} : { profileCompletedClaimed }),
    ...(levelUp ?? {}),
  }
  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

export const GET = withErrorHandling(GET_HANDLER)
export const POST = withErrorHandling(POST_HANDLER)
