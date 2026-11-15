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
      if (ttlSeconds > 0) {
        await kv.set(key, value, { ex: ttlSeconds });
      } else {
        await kv.set(key, value); // No expiry
      }
    } else {
      // Fallback to memory cache
      memoryCache.set(key, {
        value,
        expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : Infinity,
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
 * Take a short-lived lock (set-if-absent). Returns an owner token when this caller holds it, else null.
 * If the cache itself is unreachable it returns a token so work is never blocked.
 */
export async function cacheLock(key: string, ttlSeconds: number): Promise<string | null> {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    if (isKVConfigured()) {
      const res = await kv.set(key, token, { nx: true, ex: ttlSeconds });
      return res !== null ? token : null;
    }
    const entry = memoryCache.get(key);
    if (entry && Date.now() <= entry.expiresAt) return null;
    memoryCache.set(key, { value: token, expiresAt: Date.now() + ttlSeconds * 1000 });
    return token;
  } catch {
    return token;
  }
}

/** Release a lock only if it is still ours (it may have expired and been taken by someone else). */
export async function cacheUnlock(key: string, token: string): Promise<void> {
  if ((await cacheGet<string>(key)) === token) await cacheDel(key);
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
