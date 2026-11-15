import { after } from "next/server";
import { cacheGet, cacheSet, cacheLock, cacheUnlock } from "@/app/api/lib/cache";

type Envelope<T> = { value: T; fetchedAt: number };

export type SwrOptions = {
  /** Seconds a value is served without any refresh. */
  freshSeconds: number;
  /** Seconds a value is kept at all; stale values inside this window are served while refreshing. */
  keepSeconds: number;
  /** Bypass the cache and block on a fresh load. */
  forceRefresh?: boolean;
  /** Runs a background task; defaults to Next's after(), falling back to fire-and-forget. */
  schedule?: (task: () => Promise<void>) => void;
};

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
  opts: SwrOptions,
): Promise<{ value: T; cached: boolean }> {
  const schedule = opts.schedule ?? defaultSchedule;
  const lockKey = `${key}:refresh-lock`;

  const loadAndStore = async (): Promise<T> => {
    const value = await load();
    await cacheSet<Envelope<T>>(key, { value, fetchedAt: Date.now() }, opts.keepSeconds);
    return value;
  };

  if (!opts.forceRefresh) {
    const hit = await cacheGet<unknown>(key);
    if (hit) {
      const env = hit as Envelope<T>;
      const hasEnvelope = typeof env.fetchedAt === "number" && "value" in env;
      const value = (hasEnvelope ? env.value : hit) as T;
      const fresh = hasEnvelope && Date.now() - env.fetchedAt < opts.freshSeconds * 1000;
      if (!fresh) {
        schedule(async () => {
          // Single flight: only the caller that takes the lock refreshes.
          if (!(await cacheLock(lockKey, 60))) return;
          try {
            await loadAndStore();
          } catch {
            // keep serving the stale value
          } finally {
            await cacheUnlock(lockKey);
          }
        });
      }
      return { value, cached: true };
    }
  }

  return { value: await loadAndStore(), cached: false };
}
