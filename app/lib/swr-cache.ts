import { after } from "next/server";
import { cacheGet, cacheSet, cacheDel, cacheLock, cacheUnlock } from "@/app/api/lib/cache";

type Envelope<T> = { value: T; fetchedAt: number };

export type SwrOptions<T = unknown> = {
  /** Seconds a value is served without any refresh. */
  freshSeconds: number;
  /** Seconds a value is kept at all; stale values inside this window are served while refreshing. */
  keepSeconds: number;
  /** Serve a stale value while refreshing. When false, a stale value is treated as a miss (blocking load). */
  serveStale?: boolean;
  /** Cached values failing this check are treated as a miss. */
  isValid?: (value: T) => boolean;
  /** Bypass the cache and block on a fresh load. */
  forceRefresh?: boolean;
  /** Runs a background task; defaults to Next's after(), falling back to fire-and-forget. */
  schedule?: (task: () => Promise<void>) => void;
};

const genKey = (key: string) => `${key}:gen`;

/** Drop a cached value and bump its generation so a refresh already in flight cannot write old data back. */
export async function swrInvalidate(key: string, ...legacyKeys: string[]): Promise<void> {
  await cacheSet(genKey(key), `${Date.now()}-${Math.random().toString(36).slice(2)}`, 60 * 60 * 24 * 7);
  await Promise.all([key, ...legacyKeys].map((k) => cacheDel(k)));
}

function defaultSchedule(task: () => Promise<void>) {
  try {
    after(task);
  } catch {
    void task();
  }
}

/**
 * Stale-while-revalidate over the shared cache. A fresh value is returned as is; a stale value is
 * returned immediately while one caller (holding a lock) refreshes it in the background; the
 * caller only waits when nothing is cached. Entries without a timestamp count as stale.
 */
export async function swrGet<T>(
  key: string,
  load: () => Promise<T>,
  opts: SwrOptions<T>,
): Promise<{ value: T; cached: boolean }> {
  const schedule = opts.schedule ?? defaultSchedule;
  const lockKey = `${key}:refresh-lock`;

  const loadAndStore = async (): Promise<T> => {
    const gen = await cacheGet<string>(genKey(key));
    const value = await load();
    // Invalidated while loading: hand back what we read but do not store it.
    if ((await cacheGet<string>(genKey(key))) !== gen) return value;
    await cacheSet<Envelope<T>>(key, { value, fetchedAt: Date.now() }, opts.keepSeconds);
    // Invalidated between the check and the write: remove what we just stored.
    if ((await cacheGet<string>(genKey(key))) !== gen) await cacheDel(key);
    return value;
  };

  if (!opts.forceRefresh) {
    const hit = await cacheGet<unknown>(key);
    if (hit) {
      const env = hit as Envelope<T>;
      const hasEnvelope = typeof env.fetchedAt === "number" && "value" in env;
      const value = (hasEnvelope ? env.value : hit) as T;
      if (opts.isValid && !opts.isValid(value)) return { value: await loadAndStore(), cached: false };
      const fresh = hasEnvelope && Date.now() - env.fetchedAt < opts.freshSeconds * 1000;
      if (!fresh && opts.serveStale === false) return { value: await loadAndStore(), cached: false };
      if (!fresh) {
        schedule(async () => {
          // Single flight: only the caller that takes the lock refreshes.
          const token = await cacheLock(lockKey, 60);
          if (!token) return;
          try {
            await loadAndStore();
          } catch {
            // keep serving the stale value
          } finally {
            await cacheUnlock(lockKey, token);
          }
        });
      }
      return { value, cached: true };
    }
  }

  return { value: await loadAndStore(), cached: false };
}
