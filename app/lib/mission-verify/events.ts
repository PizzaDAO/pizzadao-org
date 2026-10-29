/**
 * Event hooks (plans/mission-verification.md §3.4): when something a verifier
 * looks at changes (X linked, wallet connected, crew joined, attendance
 * synced, vouch given), re-run the member's verifiers in the background.
 *
 * Call it from a route inside `after()` so it never delays the response:
 *
 *   after(() => emitMissionEvent(discordId, 'x_linked'))
 *
 * No-op while missions.verifiersEnabled is off. Never throws.
 */
import { clearBoxCache } from '../rare-pizza-box'
import { fetchMemberIdByDiscordId } from '../sheets/member-repository'
import { runVerifiers, type RunReport } from './engine'
import { announceMissionResults } from './notify'
import { missionVerifiersEnabled } from './policy'
import type { MissionEvent } from './types'

/** Which verifiers an event can change; null = all of them. */
const EVENT_VERIFIERS: Record<MissionEvent, string[] | null> = {
  x_linked: ['x_linked'],
  wallet_connected: ['wallet_connected', 'rare_pizza_box'],
  attendance_synced: ['attendance_count'],
  crew_joined: null,
  referral_created: ['referral'],
  vouch_created: ['vouch_given'],
  vouch_received: ['vouch_received'],
  // Also the automatic passes that wait (outcome 'locked') until the member reaches the mission's level.
  level_reached: ['rare_pizza_box', 'vouch_received', 'discord_role'],
}

export async function emitMissionEvent(
  discordId: string,
  event: MissionEvent,
  opts: { memberId?: string | null } = {},
): Promise<RunReport | null> {
  if (!discordId || !(await missionVerifiersEnabled())) return null
  try {
    const keys = EVENT_VERIFIERS[event]
    // A wallet was just connected: a cached "no box" is stale, look again.
    if (event === 'wallet_connected') {
      const memberId = opts.memberId ?? (await fetchMemberIdByDiscordId(discordId).catch(() => null))
      if (memberId) await clearBoxCache(memberId).catch(() => {})
    }
    const report = await runVerifiers(discordId, {
      trigger: 'event',
      ...(keys ? { verifierKeys: keys } : {}),
      ...(opts.memberId !== undefined ? { memberId: opts.memberId } : {}),
    })
    if (report.approved.length || report.levelsPaid.length) {
      const titles = report.checks.filter((c) => c.outcome === 'approved').map((c) => c.title)
      await announceMissionResults({ discordId, trigger: 'event', approvedTitles: titles, levelsPaid: report.levelsPaid })
    }
    return report
  } catch (err) {
    console.error(`[missions] ${event} hook failed for ${discordId}:`, err)
    return null
  }
}

/** Run the hook for many members, a few at a time (attendance sync). */
export async function emitMissionEventMany(discordIds: readonly string[], event: MissionEvent, concurrency = 4): Promise<void> {
  if (!(await missionVerifiersEnabled()) || discordIds.length === 0) return
  const queue = [...new Set(discordIds)]
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (let id = queue.shift(); id; id = queue.shift()) await emitMissionEvent(id, event)
    }),
  )
}
