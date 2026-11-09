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
import { extractMentionIdsFromAll, type ResolvedUser } from "./discord-markup"
import { getGuildChannels, getGuildRoles, getGuildMemberName, type DiscordOpts } from "./discord-channels"
import { prisma } from "./db"

// Most distinct non-member ids looked up via the bot per call (each is one
// cached REST call); the rest fall back to "@user".
const MAX_BOT_USER_LOOKUPS = 25

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
  try {
    const rows = await prisma.member.findMany({
      where: { discordId: { in: userIds } },
      select: { id: true, discordId: true, name: true },
    })
    for (const row of rows) {
      const name = (row.name ?? "").trim()
      if (row.discordId && name && !users[row.discordId]) users[row.discordId] = { name, memberId: row.id }
    }
  } catch {
    // DB unavailable: fall through to the Discord lookup.
  }
  const rest = userIds.filter((id) => !users[id]).slice(0, MAX_BOT_USER_LOOKUPS)
  const names = await Promise.all(rest.map((id) => getGuildMemberName(id, opts).catch(() => null)))
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

  const [channelList, roleList, users] = await Promise.all([
    channelIds.length > 0 ? getGuildChannels(opts) : Promise.resolve(null),
    roleIds.length > 0 ? getGuildRoles(opts) : Promise.resolve(null),
    resolveUsers(userIds, opts).catch(() => ({}) as Record<string, ResolvedUser>),
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

  return { channels, roles, users, guildId }
}
