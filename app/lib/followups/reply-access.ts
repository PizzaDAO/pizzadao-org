/**
 * Who may read members' DM replies to follow-ups: members at or above the `followups.replyMinLevel`
 * setting (default 7), or Dread Pizza Roberts. Anyone else who can open the queue still sees that a
 * reply exists but not its text. Evaluated once per request; any lookup failure fails closed.
 */
import { getCurrentLevel } from '@/app/lib/missions'
import { isDreadPizzaRoberts } from '@/app/lib/mission-review-access'
import { getSetting } from '@/app/lib/settings'
import type { Session } from '@/app/lib/session'

/** The current minimum level (admin setting). */
export function replyMinLevel(): Promise<number> {
  return getSetting('followups.replyMinLevel')
}

/** `session`: when given, a Telegram-started session is refused (unless allowed): DM replies are private. */
export async function canReadFollowUpReplies(discordId: string, session?: Pick<Session, 'authMethod'>): Promise<boolean> {
  if (!discordId) return false
  if (session?.authMethod === 'telegram') {
    // Lazy: the guards module needs SESSION_SECRET at import time.
    const { telegramSessionBlocked } = await import('@/app/lib/auth-guards')
    if (await telegramSessionBlocked(session)) return false
  }
  const [level, minLevel] = await Promise.all([getCurrentLevel(discordId).catch(() => 0), replyMinLevel().catch(() => 9)])
  if (level >= minLevel) return true
  return isDreadPizzaRoberts(discordId).catch(() => false)
}
