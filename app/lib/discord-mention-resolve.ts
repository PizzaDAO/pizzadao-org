/**
 * Server-side helper that turns the `<#id>` / `<@&id>` mentions inside a
 * batch of Discord-sourced text (job descriptions, etc.) into id -> name
 * maps the client can render with, via `app/ui/shared/DiscordText.tsx` and
 * `parseDiscordMarkup`. The bot token never leaves the server: this only
 * returns names (and the public guild id used to build
 * discord.com/channels/... links), restricted to the ids actually
 * referenced, so a response doesn't leak the whole guild's channel/role list.
 *
 * Channel and role lists are fetched once per hour and cached in memory by
 * `discord-channels.ts` (getGuildChannels / getGuildRoles), so calling this
 * on every request is cheap.
 */
import { extractMentionIdsFromAll } from "./discord-markup"
import { getGuildChannels, getGuildRoles, type DiscordOpts } from "./discord-channels"

export interface ResolvedMentionMaps {
  channels: Record<string, string>
  roles: Record<string, string>
  guildId: string | null
}

/** Resolve the channel/role mentions referenced across `texts`. Never throws. */
export async function resolveDiscordMentions(
  texts: string[],
  opts: DiscordOpts = {},
): Promise<ResolvedMentionMaps> {
  const guildId = (opts.guildId ?? process.env.DISCORD_GUILD_ID ?? "").trim() || null
  const { channelIds, roleIds } = extractMentionIdsFromAll(texts)

  const channels: Record<string, string> = {}
  const roles: Record<string, string> = {}

  if (channelIds.length === 0 && roleIds.length === 0) {
    return { channels, roles, guildId }
  }

  const [channelList, roleList] = await Promise.all([
    channelIds.length > 0 ? getGuildChannels(opts) : Promise.resolve(null),
    roleIds.length > 0 ? getGuildRoles(opts) : Promise.resolve(null),
  ])

  if (channelList) {
    const byId = new Map(channelList.map((c) => [c.id, c.name]))
    for (const id of channelIds) {
      const name = byId.get(id)
      if (name) channels[id] = name
    }
  }

  if (roleList) {
    const byId = new Map(roleList.map((r) => [r.id, r.name]))
    for (const id of roleIds) {
      const name = byId.get(id)
      if (name) roles[id] = name
    }
  }

  return { channels, roles, guildId }
}
