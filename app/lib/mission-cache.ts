/**
 * In-memory cache for mission progress (per member, 5-min TTL).
 * Shared between progress routes and mutation routes for invalidation.
 */

const progressCache = new Map<string, { data: any; timestamp: number }>()
const PROGRESS_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

/**
 * Get cached mission progress for a given key (discordId or memberId).
 * Returns null if not cached or expired.
 */
export function getCachedProgress(key: string) {
  const cached = progressCache.get(key)
  if (cached && Date.now() - cached.timestamp < PROGRESS_CACHE_TTL) {
    return cached.data
  }
  progressCache.delete(key)
  return null
}

/**
 * Store mission progress in cache, with size limit to prevent memory leaks.
 */
export function setCachedProgress(key: string, data: any) {
  // Limit cache size to prevent memory leaks in serverless
  if (progressCache.size > 1000) {
    const entries = [...progressCache.entries()]
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp)
    // Clear oldest half
    for (let i = 0; i < entries.length / 2; i++) {
      progressCache.delete(entries[i][0])
    }
  }
  progressCache.set(key, { data, timestamp: Date.now() })
}

/**
 * Invalidate cached progress for a specific member (by discordId).
 * Called after mission submission, approval, or rejection.
 */
export function invalidateProgressCache(discordId: string) {
  // Remove by discordId key
  progressCache.delete(discordId)
  // Also remove any memberId-keyed entries that may reference this discordId.
  // Since we can't reverse-map memberId->discordId cheaply, we store a
  // secondary index when caching by memberId.
  const aliasKey = `_alias:${discordId}`
  const memberIds = progressCache.get(aliasKey)
  if (memberIds && Array.isArray(memberIds.data)) {
    for (const mid of memberIds.data) {
      progressCache.delete(mid)
    }
    progressCache.delete(aliasKey)
  }
}

/**
 * Register a memberId alias so we can invalidate by discordId later.
 */
export function registerProgressAlias(discordId: string, memberId: string) {
  const aliasKey = `_alias:${discordId}`
  const existing = progressCache.get(aliasKey)
  if (existing && Array.isArray(existing.data)) {
    if (!existing.data.includes(memberId)) {
      existing.data.push(memberId)
    }
  } else {
    progressCache.set(aliasKey, { data: [memberId], timestamp: Date.now() })
  }
}

// ===== Missions list cache (rarely changes) =====

let missionsListCache: { data: any; timestamp: number } | null = null
const MISSIONS_LIST_CACHE_TTL = 10 * 60 * 1000 // 10 minutes (definitions rarely change)

export function getCachedMissionsList() {
  if (missionsListCache && Date.now() - missionsListCache.timestamp < MISSIONS_LIST_CACHE_TTL) {
    return missionsListCache.data
  }
  missionsListCache = null
  return null
}

export function setCachedMissionsList(data: any) {
  missionsListCache = { data, timestamp: Date.now() }
}
