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
const MAX_TRACKED = 5_000

// Per instance and best effort, like the in-memory rate limiter fallback.
const lastFresh = new Map<string, number>()

export function __resetLaneFreshRetries() {
  lastFresh.clear()
}

function allowFresh(discordId: string, now: number): boolean {
  const last = lastFresh.get(discordId)
  if (last !== undefined && now - last < FRESH_RETRY_MS) return false
  if (lastFresh.size >= MAX_TRACKED) {
    for (const [k, t] of lastFresh) if (now - t >= FRESH_RETRY_MS) lastFresh.delete(k)
    if (lastFresh.size >= MAX_TRACKED) lastFresh.clear()
  }
  lastFresh.set(discordId, now)
  return true
}

export async function memberIdForLanes(discordId: string, now = Date.now()): Promise<string | null> {
  const cached = await fetchMemberIdByDiscordId(discordId).catch(() => null)
  if (cached) return cached
  if (!allowFresh(discordId, now)) return null
  return fetchMemberIdByDiscordId(discordId, { fresh: true }).catch(() => null)
}
