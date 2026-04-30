import { fetchMemberByDiscordId, fetchMemberIdByDiscordId } from './sheets/member-repository';

/**
 * Look up a member's memberId and name from their Discord ID.
 * Delegates to member-repository's cached sheet data.
 */
export async function findMemberByDiscordId(
  discordId: string
): Promise<{ memberId: string; name: string } | null> {
  return fetchMemberByDiscordId(discordId);
}

/**
 * Convenience: just get the memberId from discordId
 */
export async function findMemberIdByDiscordId(
  discordId: string
): Promise<string | null> {
  return fetchMemberIdByDiscordId(discordId);
}
