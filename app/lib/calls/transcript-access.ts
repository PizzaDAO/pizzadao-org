/**
 * Who may read the full transcript of a published call: members at level 6 or
 * above, or Dread Pizza Roberts. Evaluated per request; any lookup failure
 * fails closed (no transcript).
 */
import { getCurrentLevel } from '@/app/lib/missions'
import { canReviewMission, DPR_ONLY_MIN_LEVEL } from '@/app/lib/mission-review-access'

export const CALL_TRANSCRIPT_MIN_LEVEL = 6

export async function canViewCallTranscript(discordId: string): Promise<boolean> {
  if (!discordId) return false
  const [level, dpr] = await Promise.all([
    getCurrentLevel(discordId).then((l) => (typeof l === 'number' ? l : 0)).catch(() => 0),
    canReviewMission(discordId, DPR_ONLY_MIN_LEVEL).catch(() => false),
  ])
  return dpr || level >= CALL_TRANSCRIPT_MIN_LEVEL
}
