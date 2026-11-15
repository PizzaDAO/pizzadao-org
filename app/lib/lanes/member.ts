/**
 * The member id for a session, for the lane guide and its APIs. The members cache can be a little
 * behind a profile that was created a moment ago (the signup lands here right after), so a miss
 * is retried with a fresh read before the visitor is treated as having no profile. That uncached
 * read is throttled per Discord id (FRESH_RETRY_MS), so a signed-in user without a profile cannot
 * force a fresh members read on every request; inside the window a miss just counts as no profile.
 * Never throws.
 */
import { fetchMemberIdByDiscordId } from '@/app/lib/sheets/member-repository'

/** Short enough that a signup landing here moments after a first miss still gets its fresh read. */
export const FRESH_RETRY_MS = 10_000
/** How long a fresh hit is remembered: the shared members cache can lag a new profile by about this long. */
export const FRESH_HIT_MS = 150_000
const MAX_TRACKED = 5_000

// Per instance and best effort, like the in-memory rate limiter fallback. Only misses of the fresh
// read are throttled; a fresh hit is remembered so the next requests (the pin on arrival, the first
// ticks) do not depend on the lagging cache.
const lastMiss = new Map<string, number>()
const recentHits = new Map<string, { memberId: string; at: number }>()

export function __resetLaneFreshRetries() {
  lastMiss.clear()
  recentHits.clear()
}

function bounded<V>(map: Map<string, V>, at: (v: V) => number, ttl: number, now: number) {
  if (map.size < MAX_TRACKED) return
  for (const [k, v] of map) if (now - at(v) >= ttl) map.delete(k)
  if (map.size >= MAX_TRACKED) map.clear()
}

export async function memberIdForLanes(discordId: string, now = Date.now()): Promise<string | null> {
  const cached = await fetchMemberIdByDiscordId(discordId).catch(() => null)
  if (cached) return cached
  const hit = recentHits.get(discordId)
  if (hit && now - hit.at < FRESH_HIT_MS) return hit.memberId
  const miss = lastMiss.get(discordId)
  if (miss !== undefined && now - miss < FRESH_RETRY_MS) return null
  const fresh = await fetchMemberIdByDiscordId(discordId, { fresh: true }).catch(() => null)
  if (fresh) {
    bounded(recentHits, (v) => v.at, FRESH_HIT_MS, now)
    recentHits.set(discordId, { memberId: fresh, at: now })
    lastMiss.delete(discordId)
  } else {
    bounded(lastMiss, (v) => v, FRESH_RETRY_MS, now)
    lastMiss.set(discordId, now)
  }
  return fresh
}
