/**
 * The public name of one Discord channel, for rendering `<#id>` mentions that
 * appear in public text (job descriptions, bounties, proposals).
 *
 * The bot can see channels @everyone cannot, and members write the text that
 * gets resolved, so a name is only returned when the channel is in OUR guild
 * and is public by the same rule the profile activity block uses
 * (`publicChannelNames`: @everyone, or a configured verified-member role, can
 * view it, judged from the channel's permission overwrites). Threads are
 * judged by their parent channel; private threads are never named. Anything
 * else gives null, and a hidden name is never written to memory or KV.
 *
 * One small REST call per channel (the guild-wide list times out in prod),
 * cached per id in memory and, for public names, in the shared KV.
 */
import { cacheDel, cacheGet, cacheSet } from '../api/lib/cache'
import { fetchChannel, getGuildRoles, type ChannelInfo, type DiscordOpts } from './discord-channels'
import { parsePublicRoleIds, publicChannelNames } from './discord-activity-public'
import { getSetting } from './settings'

const TTL_MS = 60 * 60 * 1000
const FAIL_TTL_MS = 60 * 1000
/** Like the public channel-names cache: a channel that turns private can't be served for long. */
const KV_TTL_S = 6 * 60 * 60
const SNOWFLAKE = /^\d{5,25}$/
const PUBLIC_THREAD = new Set([10, 11])
const PRIVATE_THREAD = 12

const cache = new Map<string, { name: string | null; at: number; ttl: number }>()
const kvKey = (guildId: string, id: string) => `discord:channel-name:v2:${guildId}:${id}`

export function clearChannelNamesCache() {
  cache.clear()
}

// Concurrent lookups (a job text with many channels) share one role-list fetch
// instead of each racing the cold cache.
let rolesInflight: Promise<Awaited<ReturnType<typeof getGuildRoles>>> | null = null
function sharedRoles(opts: DiscordOpts) {
  rolesInflight ??= getGuildRoles(opts).finally(() => {
    rolesInflight = null
  })
  return rolesInflight
}

type Vet = { name: string | null; ttl: number; definite: boolean }

function isPublic(
  guildId: string,
  everyonePermissions: string,
  roles: Array<{ id: string; permissions?: string }>,
  judged: ChannelInfo,
  name: string,
): boolean {
  const overwrites = judged.permissionOverwrites ?? []
  return publicChannelNames(guildId, everyonePermissions, [{ name, type: judged.type, permission_overwrites: overwrites }], roles).size > 0
}

async function vet(channelId: string, guildId: string, opts: DiscordOpts): Promise<Vet> {
  const r = await fetchChannel(channelId, opts)
  if (!r.ok) {
    if (r.status === 404 || r.status === 403) return { name: null, ttl: TTL_MS, definite: true }
    return { name: null, ttl: r.status === 429 && r.retryAfterMs ? r.retryAfterMs : FAIL_TTL_MS, definite: false }
  }
  const ch = r.channel
  if (ch.guildId !== guildId || !ch.name || ch.type === PRIVATE_THREAD) return { name: null, ttl: TTL_MS, definite: true }

  // A public thread is judged by its parent channel's rules (one level up).
  let judged: ChannelInfo = ch
  if (ch.type !== undefined && PUBLIC_THREAD.has(ch.type)) {
    if (!ch.parentId) return { name: null, ttl: TTL_MS, definite: true }
    const p = await fetchChannel(ch.parentId, opts)
    if (!p.ok) return { name: null, ttl: p.status === 404 || p.status === 403 ? TTL_MS : FAIL_TTL_MS, definite: false }
    if (p.channel.guildId !== guildId || (p.channel.type !== undefined && (PUBLIC_THREAD.has(p.channel.type) || p.channel.type === PRIVATE_THREAD))) {
      return { name: null, ttl: TTL_MS, definite: true }
    }
    judged = p.channel
  }

  const roles = await sharedRoles(opts)
  const everyone = roles?.find((ro) => ro.id === guildId)
  if (!roles || !everyone) return { name: null, ttl: FAIL_TTL_MS, definite: false } // can't vet: show nothing
  const wanted = parsePublicRoleIds(await getSetting('members.discordActivityPublicRoleIds').catch(() => ''))
  const configured = roles.filter((ro) => wanted.includes(ro.id))
  const ok = isPublic(guildId, everyone.permissions ?? '0', configured, judged, ch.name)
  return { name: ok ? ch.name : null, ttl: TTL_MS, definite: true }
}

/** The channel's name when it is public in our guild, else null. Never throws. */
export async function getPublicChannelName(channelId: string, opts: DiscordOpts = {}): Promise<string | null> {
  const guildId = (opts.guildId ?? process.env.DISCORD_GUILD_ID ?? '').trim()
  if (!guildId || !SNOWFLAKE.test(channelId)) return null
  const now = opts.now ?? Date.now()
  const hit = cache.get(channelId)
  if (hit && now - hit.at < hit.ttl) return hit.name
  try {
    const key = kvKey(guildId, channelId)
    const cached = await cacheGet<string>(key).catch(() => null)
    if (typeof cached === 'string' && cached) {
      cache.set(channelId, { name: cached, at: now, ttl: TTL_MS })
      return cached
    }
    const v = await vet(channelId, guildId, opts)
    cache.set(channelId, { name: v.name, at: now, ttl: v.ttl })
    if (v.name) await cacheSet(key, v.name, KV_TTL_S).catch(() => {})
    else if (v.definite) await cacheDel(key).catch(() => {})
    return v.name
  } catch {
    return null
  }
}
