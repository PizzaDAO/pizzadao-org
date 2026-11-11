/**
 * A crew's "Join on Discord" link, from its `Channel` cell (a discord.com/channels link, a bare
 * channel id, a <#id> mention or a channel name) and the guild id from DISCORD_GUILD_ID. Pure: the
 * caller passes the guild's channel list (for names) so it can be tested without Discord.
 */
import { normalizeChannelName } from '@/app/lib/discord-channels'

export type LinkableChannel = { id: string; name: string; type: number }

// Text (0), voice (2), announcement (5) and stage (13) channels can be opened from a link.
const LINKABLE_TYPES = new Set([0, 2, 5, 13])
const SNOWFLAKE = /^\d{5,25}$/

export function crewDiscordUrl(
  cell: string | null | undefined,
  guildId: string | null | undefined,
  channels?: LinkableChannel[] | null,
): string | null {
  const v = (cell ?? '').trim()
  if (!v) return null
  const guild = (guildId ?? '').trim()
  if (!guild) return null

  const link = v.match(/^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(\d{5,25})\/(\d{5,25})/i)
  if (link) {
    // A link into another server is not ours to promote.
    if (link[1] !== guild) return null
    return `https://discord.com/channels/${link[1]}/${link[2]}`
  }
  if (SNOWFLAKE.test(v)) return `https://discord.com/channels/${guild}/${v}`
  const mention = v.match(/^<#(\d{5,25})>$/)
  if (mention) return `https://discord.com/channels/${guild}/${mention[1]}`

  const want = normalizeChannelName(v)
  if (!want || !channels) return null
  const hit = channels.find((c) => LINKABLE_TYPES.has(c.type) && normalizeChannelName(c.name) === want)
  return hit ? `https://discord.com/channels/${guild}/${hit.id}` : null
}
