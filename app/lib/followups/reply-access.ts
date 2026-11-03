/**
 * Who may read members' DM replies to follow-ups: members at or above the `followups.replyMinLevel`
 * setting (default 7), or Dread Pizza Roberts. Anyone else who can open the queue still sees that a
 * reply exists but not its text. Evaluated once per request; any lookup failure fails closed.
 */
import { getCurrentLevel } from '@/app/lib/missions'
import { isDreadPizzaRoberts } from '@/app/lib/mission-review-access'
import { getSetting } from '@/app/lib/settings'

/** The current minimum level (admin setting). */
export function replyMinLevel(): Promise<number> {
  return getSetting('followups.replyMinLevel')
}

export async function canReadFollowUpReplies(discordId: string): Promise<boolean> {
  if (!discordId) return false
  const [level, minLevel] = await Promise.all([getCurrentLevel(discordId).catch(() => 0), replyMinLevel().catch(() => 9)])
  if (level >= minLevel) return true
  return isDreadPizzaRoberts(discordId).catch(() => false)
}
