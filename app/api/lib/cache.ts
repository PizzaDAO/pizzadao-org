import { kv } from "@vercel/kv";

// Cache configuration
const DEFAULT_TTL = 60 * 10; // 10 minutes in seconds
const TASK_LINKS_TTL = 60 * 30; // 30 minutes for task links (less volatile)
const CREW_MAPPINGS_TTL = 60 * 5; // 5 minutes for crew mappings

// In-memory fallback for local development (when KV is not configured)
const memoryCache = new Map<string, { value: unknown; expiresAt: number }>();

// Check if Vercel KV is configured
function isKVConfigured(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

/**
 * Get a value from cache (Vercel KV in production, memory locally)
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    if (isKVConfigured()) {
      return await kv.get<T>(key);
    }

    // Fallback to memory cache
    const entry = memoryCache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      memoryCache.delete(key);
      return null;
    }
    return entry.value as T;
  } catch (error) {
    return null;
  }
}

/**
 * Set a value in cache with TTL
 */
export async function cacheSet<T>(key: string, value: T, ttlSeconds: number = DEFAULT_TTL): Promise<void> {
  try {
    if (isKVConfigured()) {
      await kv.set(key, value, { ex: ttlSeconds });
    } else {
      // Fallback to memory cache
      memoryCache.set(key, {
        value,
        expiresAt: Date.now() + ttlSeconds * 1000,
      });
    }
  } catch (error) {
  }
}

/**
 * Delete a key from cache
 */
export async function cacheDel(key: string): Promise<void> {
  try {
    if (isKVConfigured()) {
      await kv.del(key);
    } else {
      memoryCache.delete(key);
    }
  } catch (error) {
  }
}

/**
 * Get or set pattern - fetch from cache or compute and cache
 */
export async function cacheGetOrSet<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlSeconds: number = DEFAULT_TTL
): Promise<T> {
  const cached = await cacheGet<T>(key);
  if (cached !== null) {
    return cached;
  }

  const value = await fetchFn();
  await cacheSet(key, value, ttlSeconds);
  return value;
}

// Export TTL constants for use in other modules
export const CACHE_TTL = {
  DEFAULT: DEFAULT_TTL,
  TASK_LINKS: TASK_LINKS_TTL,
  CREW_MAPPINGS: CREW_MAPPINGS_TTL,
};
