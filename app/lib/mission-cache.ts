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
const MISSIONS_LIST_CACHE_TTL = 60 * 1000 // 60s: admin edits (/admin/missions) must reach every instance quickly

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

// ===== Mission rows cache (every Mission row, shared by the level and progress reads) =====

/**
 * How long one load of the Mission table is reused in this instance. Admin edits clear it here at
 * once (clearMissionCaches); other instances see them within this window.
 */
export const MISSION_ROWS_CACHE_MS = 60_000

let missionRows: { rows: unknown[]; at: number; fp: string | null } | null = null
let missionRowsInflight: Promise<unknown[]> | null = null

/**
 * The cached Mission rows, loading them with `load` when stale. Concurrent callers share one load.
 * With `fingerprint` (db-fingerprint.ts), an expired copy is kept when the table is unchanged, so
 * the refresh moves 32 bytes instead of every row; it is taken before the load, so a change landing
 * during the load is caught next time. A failed load is not cached (it rejects, as the query did),
 * and neither is an empty table, so a fail-closed "no active missions" check keeps asking.
 */
export async function cachedMissionRows<T>(
  load: () => Promise<T[]>,
  now: number = Date.now(),
  fingerprint: () => Promise<string | null> = async () => null,
): Promise<T[]> {
  if (missionRows && now - missionRows.at < MISSION_ROWS_CACHE_MS) return missionRows.rows as T[]
  if (!missionRowsInflight) {
    const prev = missionRows
    const p: Promise<unknown[]> = (async () => {
      const fp = await fingerprint().catch(() => null)
      if (fp && prev?.fp === fp) return { list: prev.rows, fp }
      const rows = await load()
      return { list: Array.isArray(rows) ? (rows as unknown[]) : [], fp }
    })()
      .then(({ list, fp }) => {
        // Only the load still current may fill the cache (an admin edit may have cleared it meanwhile).
        if (list.length > 0 && missionRowsInflight === p) missionRows = { rows: list, at: now, fp }
        return list
      })
      .finally(() => {
        if (missionRowsInflight === p) missionRowsInflight = null
      })
    missionRowsInflight = p
  }
  return missionRowsInflight as Promise<T[]>
}

/** After an admin edit of missions: drop the lists and every member's cached progress in this instance. */
export function clearMissionCaches() {
  missionsListCache = null
  missionRows = null
  missionRowsInflight = null
  progressCache.clear()
}
