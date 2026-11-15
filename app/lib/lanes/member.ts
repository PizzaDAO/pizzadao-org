/**
 * The member id for a session, for the lane guide and its APIs. The members cache can be a little
 * behind a profile that was created a moment ago (the signup lands here right after), so a miss
 * is retried once with a fresh read before the visitor is treated as having no profile. Never throws.
 */
import { fetchMemberIdByDiscordId } from '@/app/lib/sheets/member-repository'

export async function memberIdForLanes(discordId: string): Promise<string | null> {
  const cached = await fetchMemberIdByDiscordId(discordId).catch(() => null)
  if (cached) return cached
  return fetchMemberIdByDiscordId(discordId, { fresh: true }).catch(() => null)
}
