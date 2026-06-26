import { prisma } from './db'

/**
 * Celebration loop state — gates one-shot UI moments (confetti overlay, level-up
 * modal, vouch prompt) so they never replay for the same member.
 *
 * Storage lives on `MemberProfileExtras` (keyed by Google Sheets memberId), so
 * callers must resolve discordId -> memberId before reading/writing.
 *
 * Plan: diavola-40350
 */

export type CelebrationState = {
  memberId: string
  lastCelebratedLevel: number
  firstMissionCelebratedAt: string | null
  vouchPromptShownAt: string | null
}

/**
 * Read celebration state for a member. Lazily creates the row if missing so
 * the caller always gets a usable object.
 */
export async function getCelebrationState(memberId: string): Promise<CelebrationState> {
  if (!memberId) {
    throw new Error('memberId required')
  }

  const existing = await prisma.memberProfileExtras.findUnique({
    where: { memberId },
    select: {
      memberId: true,
      lastCelebratedLevel: true,
      firstMissionCelebratedAt: true,
      vouchPromptShownAt: true,
    },
  })

  if (existing) {
    return {
      memberId: existing.memberId,
      lastCelebratedLevel: existing.lastCelebratedLevel,
      firstMissionCelebratedAt: existing.firstMissionCelebratedAt?.toISOString() ?? null,
      vouchPromptShownAt: existing.vouchPromptShownAt?.toISOString() ?? null,
    }
  }

  // Lazy create with defaults. `tagline` stays null; we only own celebration
  // fields here.
  const created = await prisma.memberProfileExtras.create({
    data: { memberId },
    select: {
      memberId: true,
      lastCelebratedLevel: true,
      firstMissionCelebratedAt: true,
      vouchPromptShownAt: true,
    },
  })

  return {
    memberId: created.memberId,
    lastCelebratedLevel: created.lastCelebratedLevel,
    firstMissionCelebratedAt: created.firstMissionCelebratedAt?.toISOString() ?? null,
    vouchPromptShownAt: created.vouchPromptShownAt?.toISOString() ?? null,
  }
}

export type CelebrationPatch = {
  lastCelebratedLevel?: number
  firstMissionCelebrated?: boolean
  vouchPromptDismissed?: boolean
}

/**
 * Apply a partial update to celebration state. Uses upsert so a missing row
 * is fine. Only the supplied fields are touched.
 *
 * `firstMissionCelebrated: true` stamps `firstMissionCelebratedAt = now()`.
 * `vouchPromptDismissed: true` stamps `vouchPromptShownAt = now()`.
 *
 * `lastCelebratedLevel` is monotonic — passing a smaller value than the
 * current one is a no-op (prevents clients from resetting and re-triggering
 * celebrations).
 */
export async function updateCelebrationState(
  memberId: string,
  patch: CelebrationPatch,
): Promise<CelebrationState> {
  if (!memberId) {
    throw new Error('memberId required')
  }

  const now = new Date()

  // Read current to enforce monotonicity on lastCelebratedLevel
  const current = await getCelebrationState(memberId)

  const updateData: {
    lastCelebratedLevel?: number
    firstMissionCelebratedAt?: Date
    vouchPromptShownAt?: Date
  } = {}

  if (
    typeof patch.lastCelebratedLevel === 'number' &&
    patch.lastCelebratedLevel > current.lastCelebratedLevel
  ) {
    updateData.lastCelebratedLevel = patch.lastCelebratedLevel
  }

  if (patch.firstMissionCelebrated && !current.firstMissionCelebratedAt) {
    updateData.firstMissionCelebratedAt = now
  }

  if (patch.vouchPromptDismissed && !current.vouchPromptShownAt) {
    updateData.vouchPromptShownAt = now
  }

  if (Object.keys(updateData).length === 0) {
    return current
  }

  const updated = await prisma.memberProfileExtras.update({
    where: { memberId },
    data: updateData,
    select: {
      memberId: true,
      lastCelebratedLevel: true,
      firstMissionCelebratedAt: true,
      vouchPromptShownAt: true,
    },
  })

  return {
    memberId: updated.memberId,
    lastCelebratedLevel: updated.lastCelebratedLevel,
    firstMissionCelebratedAt: updated.firstMissionCelebratedAt?.toISOString() ?? null,
    vouchPromptShownAt: updated.vouchPromptShownAt?.toISOString() ?? null,
  }
}
