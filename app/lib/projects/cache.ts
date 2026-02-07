/**
 * Simple in-memory cache for projects data
 * In production, consider using Redis or another distributed cache
 */

interface CacheEntry<T> {
  data: T
  timestamp: number
  expiresAt: number
}

const CACHE_DURATION_MS = 15 * 60 * 1000 // 15 minutes

// In-memory cache
const cache = new Map<string, CacheEntry<unknown>>()

/**
 * Get cached data if available and not expired
 */
export function getCached<T>(key: string): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined

  if (!entry) {
    return null
  }

  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return null
  }

  return entry.data
}

/**
 * Set data in cache with expiration
 */
export function setCache<T>(key: string, data: T, durationMs: number = CACHE_DURATION_MS): void {
  const now = Date.now()
  cache.set(key, {
    data,
    timestamp: now,
    expiresAt: now + durationMs,
  })
}

/**
 * Clear specific cache entry
 */
export function clearCache(key: string): void {
  cache.delete(key)
}

/**
 * Clear all cache entries
 */
export function clearAllCache(): void {
  cache.clear()
}

/**
 * Get cache metadata
 */
export function getCacheMetadata(key: string): { cachedAt: string; expiresAt: string } | null {
  const entry = cache.get(key)

  if (!entry) {
    return null
  }

  return {
    cachedAt: new Date(entry.timestamp).toISOString(),
    expiresAt: new Date(entry.expiresAt).toISOString(),
  }
}

// Cache keys
export const CACHE_KEYS = {
  ALL_PROJECTS: 'projects:all',
  PROJECT_DETAIL: (slug: string) => `projects:${slug}`,
}
