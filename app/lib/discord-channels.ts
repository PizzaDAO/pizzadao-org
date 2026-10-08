/**
 * Small Discord REST helpers for channels, roles and messages (bot token, no
 * gateway). Used by the mission verifiers (#show-and-tell message check),
 * the mission announcements (#work), and resolving `<#id>` / `<@&id>`
 * mentions in job descriptions (see discord-mention-resolve.ts).
 *
 *   - resolveChannelId(name, envName): an env override, else the guild channel
 *     with that name, cached in memory for an hour (a failed refresh keeps the
 *     stale list).
 *   - getGuildChannels / getGuildRoles: the guild's full channel or role
 *     list, each cached in memory for an hour (a failed refresh keeps the
 *     stale list). A failed refresh also starts a short (~60s) negative
 *     cache so a Discord outage doesn't make every request in that window
 *     wait out the REST timeout again — they get the stale list (or null)
 *     immediately instead.
 *   - getChannelMessage / getChannel: one REST call each. "unknown" means the
 *     call itself failed (network, 5xx, rate limit, no token), as opposed to a
 *     definite "not found" (null).
 *
 * Everything takes an optional fetchImpl so tests never reach Discord.
 */
const API = 'https://discord.com/api/v10'
const TTL_MS = 60 * 60 * 1000
const FAIL_TTL_MS = 60 * 1000
const TIMEOUT_MS = 2500
const SNOWFLAKE = /^\d{5,25}$/

export type FetchLike = typeof fetch

export interface DiscordOpts {
  botToken?: string
  guildId?: string
  fetchImpl?: FetchLike
  now?: number
}

type GuildChannel = { id: string; name: string; type: number; parent_id?: string | null }
let channelCache: { guildId: string; channels: GuildChannel[]; at: number } | null = null
let channelFailCache: { guildId: string; at: number } | null = null

export function clearGuildChannelsCache() {
  channelCache = null
  channelFailCache = null
}

type GuildRole = { id: string; name: string }
let roleCache: { guildId: string; roles: GuildRole[]; at: number } | null = null
let roleFailCache: { guildId: string; at: number } | null = null

export function clearGuildRolesCache() {
  roleCache = null
  roleFailCache = null
}

function token(opts: DiscordOpts): string {
  return (opts.botToken ?? process.env.DISCORD_BOT_TOKEN ?? '').trim()
}

function guild(opts: DiscordOpts): string {
  return (opts.guildId ?? process.env.DISCORD_GUILD_ID ?? '').trim()
}

async function getJson(path: string, opts: DiscordOpts): Promise<{ ok: true; json: unknown } | { ok: false; status: number }> {
  const t = token(opts)
  if (!t) return { ok: false, status: 0 }
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${API}${path}`, {
      headers: { Authorization: `Bot ${t}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return { ok: false, status: res.status }
    return { ok: true, json: await res.json() }
  } catch {
    return { ok: false, status: 0 }
  }
}

/** The guild's channels (cached for an hour), or null when unavailable. */
export async function getGuildChannels(opts: DiscordOpts = {}): Promise<GuildChannel[] | null> {
  const guildId = guild(opts)
  if (!guildId) return null
  const now = opts.now ?? Date.now()
  if (channelCache && channelCache.guildId === guildId && now - channelCache.at < TTL_MS) return channelCache.channels
  const stale = () => (channelCache?.guildId === guildId ? channelCache.channels : null)
  if (channelFailCache && channelFailCache.guildId === guildId && now - channelFailCache.at < FAIL_TTL_MS) {
    // A refresh failed recently — don't hit Discord (and wait out the REST
    // timeout) again until the short negative-cache window elapses.
    return stale()
  }
  const r = await getJson(`/guilds/${guildId}/channels`, opts)
  if (!r.ok || !Array.isArray(r.json)) {
    channelFailCache = { guildId, at: now }
    return stale()
  }
  const channels = (r.json as GuildChannel[]).map((c) => ({
    id: String(c.id),
    name: String(c.name ?? ''),
    type: Number(c.type),
    parent_id: c.parent_id ? String(c.parent_id) : null,
  }))
  channelCache = { guildId, channels, at: now }
  channelFailCache = null
  return channels
}

/** The guild's roles (cached for an hour), or null when unavailable. */
export async function getGuildRoles(opts: DiscordOpts = {}): Promise<GuildRole[] | null> {
  const guildId = guild(opts)
  if (!guildId) return null
  const now = opts.now ?? Date.now()
  if (roleCache && roleCache.guildId === guildId && now - roleCache.at < TTL_MS) return roleCache.roles
  const stale = () => (roleCache?.guildId === guildId ? roleCache.roles : null)
  if (roleFailCache && roleFailCache.guildId === guildId && now - roleFailCache.at < FAIL_TTL_MS) {
    return stale()
  }
  const r = await getJson(`/guilds/${guildId}/roles`, opts)
  if (!r.ok || !Array.isArray(r.json)) {
    roleFailCache = { guildId, at: now }
    return stale()
  }
  const roles = (r.json as Array<{ id: string; name: string }>).map((ro) => ({
    id: String(ro.id),
    name: String(ro.name ?? ''),
  }))
  roleCache = { guildId, roles, at: now }
  roleFailCache = null
  return roles
}

/** Normalize a channel name for matching: "#Show-and-Tell" / "🎨・show-and-tell" -> "show-and-tell". */
export function normalizeChannelName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Channel id for `name`: the env var `envName` when it holds a snowflake,
 * else the guild channel whose normalized name equals (or, failing that, ends
 * with) the normalized `name`. Text and forum channels only.
 */
export async function resolveChannelId(name: string, envName?: string, opts: DiscordOpts = {}): Promise<string | null> {
  const fromEnv = envName ? process.env[envName]?.trim() : ''
  if (fromEnv && SNOWFLAKE.test(fromEnv)) return fromEnv
  const channels = await getGuildChannels(opts)
  if (!channels) return null
  const want = normalizeChannelName(name)
  const usable = channels.filter((c) => c.type === 0 || c.type === 5 || c.type === 15)
  const exact = usable.find((c) => normalizeChannelName(c.name) === want)
  if (exact) return exact.id
  const suffix = usable.find((c) => normalizeChannelName(c.name).endsWith(`-${want}`))
  return suffix?.id ?? null
}

export type MessageInfo = { id: string; channelId: string; authorId: string; timestamp: string | null }

/** One message, or null when it doesn't exist / the bot can't see it, or "unknown" when the call failed. */
export async function getChannelMessage(channelId: string, messageId: string, opts: DiscordOpts = {}): Promise<MessageInfo | null | 'unknown'> {
  if (!SNOWFLAKE.test(channelId) || !SNOWFLAKE.test(messageId)) return null
  const r = await getJson(`/channels/${channelId}/messages/${messageId}`, opts)
  if (!r.ok) return r.status === 404 || r.status === 403 ? null : 'unknown'
  const m = r.json as { id?: string; channel_id?: string; author?: { id?: string }; timestamp?: string }
  if (!m?.author?.id) return null
  return { id: String(m.id), channelId: String(m.channel_id ?? channelId), authorId: String(m.author.id), timestamp: m.timestamp ?? null }
}

export type ChannelInfo = { id: string; parentId: string | null; guildId: string | null }

/** One channel (or thread), or null / "unknown" as above. */
export async function getChannel(channelId: string, opts: DiscordOpts = {}): Promise<ChannelInfo | null | 'unknown'> {
  if (!SNOWFLAKE.test(channelId)) return null
  const r = await getJson(`/channels/${channelId}`, opts)
  if (!r.ok) return r.status === 404 || r.status === 403 ? null : 'unknown'
  const c = r.json as { id?: string; parent_id?: string | null; guild_id?: string | null }
  return { id: String(c.id ?? channelId), parentId: c.parent_id ? String(c.parent_id) : null, guildId: c.guild_id ? String(c.guild_id) : null }
}

/**
 * Parse a Discord message link:
 *   https://discord.com/channels/<guild>/<channel>/<message>
 * (also ptb./canary. and discordapp.com). Null when it isn't one.
 */
export function parseMessageLink(raw: string | null | undefined): { guildId: string; channelId: string; messageId: string } | null {
  if (!raw) return null
  const m = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d{5,25})\/(\d{5,25})\/(\d{5,25})\/?(?:[?#].*)?$/.exec(raw.trim())
  return m ? { guildId: m[1], channelId: m[2], messageId: m[3] } : null
}
