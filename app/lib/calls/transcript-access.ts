/**
 * Who may read the full transcript of a published call: members at or above the
 * `calls.transcriptMinLevel` setting (default 6), or Dread Pizza Roberts. Evaluated per request; any lookup failure
 * fails closed (no transcript).
 */
import { getCurrentLevel } from '@/app/lib/missions'
import { isDreadPizzaRoberts } from '@/app/lib/mission-review-access'
import { getSetting } from '@/app/lib/settings'

/** Code default for the setting `calls.transcriptMinLevel`. */
export const CALL_TRANSCRIPT_MIN_LEVEL = 6

/** The current minimum level (admin setting). */
export function transcriptMinLevel(): Promise<number> {
  return getSetting('calls.transcriptMinLevel')
}

export async function canViewCallTranscript(discordId: string): Promise<boolean> {
  if (!discordId) return false
  // Level first: only fall back to the (slower) Discord role lookup below it.
  const [level, minLevel] = await Promise.all([getCurrentLevel(discordId).catch(() => 0), transcriptMinLevel()])
  if (level >= minLevel) return true
  return isDreadPizzaRoberts(discordId).catch(() => false)
}
