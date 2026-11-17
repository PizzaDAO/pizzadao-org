/**
 * Server-side helper that turns the `<#id>` / `<@&id>` mentions inside a
 * batch of Discord-sourced text (job descriptions, etc.) into id -> name
 * maps the client can render with, via `app/ui/shared/DiscordText.tsx` and
 * `parseDiscordMarkup`. The bot token never leaves the server: this only
 * returns names (and the public guild id used to build
 * discord.com/channels/... links), restricted to the ids actually
 * referenced, so a response doesn't leak the whole guild's channel/role list.
 *
 * Roles come from one cached guild list (getGuildRoles). Channel names are
 * looked up one id at a time (getChannelName, cached in memory and KV): the
 * full guild channel list times out in production, and jobs only mention a
 * handful of channels.
 */
import { extractMentionIdsFromAll, type ResolvedUser } from "./discord-markup"
import { getChannelName, getGuildRoles, getGuildMemberCleanName, type DiscordOpts } from "./discord-channels"
import { cleanChannelName } from "./discord-names"
import { memberNamesByDiscordId } from "./member-names"

// Most distinct non-member ids looked up via the bot per call (each is one
// cached REST call); the rest fall back to "@member".
const MAX_BOT_USER_LOOKUPS = 25
// Most distinct channels looked up via the bot per call (one cached REST call each).
const MAX_BOT_CHANNEL_LOOKUPS = 25

export interface ResolvedMentionMaps {
  channels: Record<string, string>
  roles: Record<string, string>
  /** user id -> display name (+ member id when they are an app member). Same for every viewer. */
  users: Record<string, ResolvedUser>
  guildId: string | null
}

/**
 * App members first (Member.discordId -> name + member id), then the guild
 * member via the bot for everyone else. Fails soft: unresolved ids are left out.
 */
async function resolveUsers(userIds: string[], opts: DiscordOpts): Promise<Record<string, ResolvedUser>> {
  const users: Record<string, ResolvedUser> = {}
  if (userIds.length === 0) return users
  const members = await memberNamesByDiscordId(userIds)
  for (const [id, m] of members) users[id] = { name: m.name, memberId: m.memberId }
  const rest = userIds.filter((id) => !users[id]).slice(0, MAX_BOT_USER_LOOKUPS)
  const names = await Promise.all(rest.map((id) => getGuildMemberCleanName(id, opts).catch(() => null)))
  rest.forEach((id, i) => {
    const name = names[i]
    if (name) users[id] = { name }
  })
  return users
}

/** Resolve the channel/role/user mentions referenced across `texts`. Never throws. */
export async function resolveDiscordMentions(
  texts: string[],
  opts: DiscordOpts = {},
): Promise<ResolvedMentionMaps> {
  const guildId = (opts.guildId ?? process.env.DISCORD_GUILD_ID ?? "").trim() || null
  const { channelIds, roleIds, userIds } = extractMentionIdsFromAll(texts)

  const channels: Record<string, string> = {}
  const roles: Record<string, string> = {}

  if (channelIds.length === 0 && roleIds.length === 0 && userIds.length === 0) {
    return { channels, roles, users: {}, guildId }
  }

  const channelLookups = channelIds.slice(0, MAX_BOT_CHANNEL_LOOKUPS)
  const [channelNames, roleList, users] = await Promise.all([
    Promise.all(channelLookups.map((id) => getChannelName(id, opts).catch(() => null))),
    roleIds.length > 0 ? getGuildRoles(opts) : Promise.resolve(null),
    resolveUsers(userIds, opts).catch(() => ({}) as Record<string, ResolvedUser>),
  ])

  channelLookups.forEach((id, i) => {
    const name = channelNames[i]
    if (name) channels[id] = cleanChannelName(name)
  })

  if (roleList) {
    const byId = new Map(roleList.map((r) => [r.id, r.name]))
    for (const id of roleIds) {
      const name = byId.get(id)
      if (name) roles[id] = name
    }
  }

  return { channels, roles, users, guildId }
}
