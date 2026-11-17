/**
 * Cache plumbing for the public profile summary (see getPublicProfileSummary).
 *
 * Two layers, both holding ONLY the viewer-independent public summary (never isOwner / viewerId,
 * disavow, passport or any members-only section):
 *   - L1: a short per-instance memory map (PROFILE_L1_TTL_MS),
 *   - L2: Next's shared data cache (`unstable_cache`), tagged "members" and `profile:<id>`.
 * Write paths that change what a profile shows call `invalidateProfileSummary(id)`.
 */
import { revalidateTag } from "next/cache";

/** Shared data-cache lifetime for one composed summary (seconds). */
export const PROFILE_SUMMARY_REVALIDATE_SECONDS = 300;
/** Per-instance memory layer in front of it. Short so another instance's invalidation shows up fast. */
export const PROFILE_L1_TTL_MS = 30 * 1000;
export const PROFILE_L1_MAX = 500;

/** The members data-cache tag (same value as MEMBERS_CACHE_TAG; a test keeps them equal). */
export const PROFILE_MEMBERS_TAG = "members";
export const profileTag = (id: string) => `profile:${id}`;

/** Per-instance L1, keyed by member id. The value is the public summary (typed by the caller). */
export const profileL1 = new Map<string, { time: number; data: unknown }>();

/**
 * Expire one member's cached summary: this instance's memory layer at once, and the shared data
 * cache for every instance. Safe to call anywhere (a no-op for the shared layer outside Next).
 */
export function invalidateProfileSummary(memberId: string | null | undefined): void {
  const id = String(memberId ?? "").trim();
  if (!id) return;
  profileL1.delete(id);
  try {
    revalidateTag(profileTag(id), { expire: 0 });
  } catch {
    // Outside a Next request (tests, scripts): there is no data cache to expire.
  }
}
