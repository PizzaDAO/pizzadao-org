/**
 * Who may see what on the live call view. Any signed-in member sees names and can ask and vote; the
 * live action items follow calls.actionItemsMinLevel (like the published call); hosts (Dread Pizza
 * Roberts plus the roles in calls.liveHostRoleIds) moderate the Q&A and run polls. One level lookup
 * and one role lookup per member, cached 60 s so a polling page never hammers the level or Discord
 * role APIs. Every failure fails closed (no items, not a host).
 */
import { getUserRoles } from '@/app/lib/discord'
import { isDreadPizzaRoberts } from '@/app/lib/mission-review-access'
import { getSetting } from '@/app/lib/settings'
import { callSectionAccess } from './transcript-access'

export const LIVE_ACCESS_CACHE_MS = 60_000

export interface LiveAccess {
  actionItems: { visible: boolean; minLevel: number }
  host: boolean
}

const CLOSED: LiveAccess = { actionItems: { visible: false, minLevel: 10 }, host: false }
const cache = new Map<string, { at: number; value: LiveAccess }>()

export function clearLiveAccessCache(): void {
  cache.clear()
}

/** Numeric role ids, one per line; anything else is dropped. */
export function parseRoleLines(raw: string): string[] {
  return raw.split('\n').map((l) => l.trim()).filter((l) => /^\d{15,25}$/.test(l))
}

async function compute(discordId: string): Promise<LiveAccess> {
  const [sections, roles, hostRaw] = await Promise.all([
    callSectionAccess(discordId).catch(() => null),
    getUserRoles(discordId).catch(() => [] as string[]),
    getSetting('calls.liveHostRoleIds').catch(() => ''),
  ])
  const hostRoles = parseRoleLines(hostRaw)
  const host = (await isDreadPizzaRoberts(roles).catch(() => false)) || roles.some((r) => hostRoles.includes(r))
  return { actionItems: sections?.actionItems ?? CLOSED.actionItems, host }
}

export async function liveAccess(discordId: string, now: number = Date.now()): Promise<LiveAccess> {
  if (!discordId) return CLOSED
  const hit = cache.get(discordId)
  if (hit && now - hit.at < LIVE_ACCESS_CACHE_MS) return hit.value
  let value: LiveAccess
  try {
    value = await compute(discordId)
  } catch {
    return CLOSED
  }
  cache.set(discordId, { at: now, value })
  if (cache.size > 2000) cache.clear()
  return value
}
