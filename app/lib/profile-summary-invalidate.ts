/**
 * Invalidate a member's cached profile summary from a Discord id (mission, ledger and level writes
 * are keyed by Discord id; the profile cache is keyed by member id).
 *
 * Call it AFTER the write succeeded and outside any DB transaction. It never throws and never
 * fails the caller: a miss only means the profile catches up when the cache expires.
 *
 * Residual lag: this clears this instance's L1 at once and expires the shared data cache for every
 * instance (revalidateTag), but another serverless instance may still serve its own L1 copy for up
 * to PROFILE_L1_TTL_MS (30 s). That is the price of the memory layer; the TTL is kept short for it.
 */
import { fetchMemberIdByDiscordId } from "./sheets/member-repository";
import { invalidateProfileSummary } from "./profile-summary-cache";

export async function invalidateProfileSummaryForDiscord(discordId: string | null | undefined): Promise<void> {
  try {
    const id = String(discordId ?? "").trim();
    if (!id) return;
    const memberId = await fetchMemberIdByDiscordId(id);
    if (memberId) invalidateProfileSummary(memberId);
  } catch {
    // Best effort only.
  }
}
