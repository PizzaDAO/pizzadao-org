/**
 * Can a guild member view a channel? Computes Discord's effective permissions from the member's roles,
 * the @everyone role and the channel's permission overwrites (role and member-specific), including
 * Administrator and the guild owner. Discord stores a synced category's overwrites on the channel itself,
 * so the channel's own overwrites are the whole story (a category is not inherited live).
 *
 * Guild roles and the guild owner are cached for a few minutes, the channel for one minute, so a daily or
 * hourly run does not hammer Discord. Everything takes an optional fetchImpl so tests never reach Discord.
 */
const B = (n: number): bigint => BigInt(n)
const API = 'https://discord.com/api/v10'
const TIMEOUT_MS = 4000
const ROLES_TTL_MS = 5 * 60 * 1000
const CHANNEL_TTL_MS = 60 * 1000
const SNOWFLAKE = /^\d{5,25}$/

export const PERM_ADMINISTRATOR = B(1) << B(3)
export const PERM_VIEW_CHANNEL = B(1) << B(10)

export interface Overwrite {
  id: string
  /** 0 = role, 1 = member */
  type: number
  allow: bigint
  deny: bigint
}

export interface ViewInput {
  guildId: string
  ownerId?: string | null
  userId: string
  /** The member's role ids (without @everyone, whose id equals the guild id). */
  memberRoleIds: string[]
  /** Role id -> permission bitfield, including @everyone (id === guildId). */
  rolePerms: Map<string, bigint>
  overwrites: Overwrite[]
}

/** Pure: the effective permission bits of a member in a channel. */
export function effectivePermissions(i: ViewInput): bigint {
  const all = (B(1) << B(53)) - B(1)
  if (i.ownerId && i.ownerId === i.userId) return all
  let perms = i.rolePerms.get(i.guildId) ?? B(0)
  for (const r of i.memberRoleIds) perms |= i.rolePerms.get(r) ?? B(0)
  if (perms & PERM_ADMINISTRATOR) return all
  const roles = new Set(i.memberRoleIds)
  const everyone = i.overwrites.find((o) => o.type === 0 && o.id === i.guildId)
  if (everyone) perms = (perms & ~everyone.deny) | everyone.allow
  let allow = B(0)
  let deny = B(0)
  for (const o of i.overwrites) {
    if (o.type === 0 && o.id !== i.guildId && roles.has(o.id)) {
      allow |= o.allow
      deny |= o.deny
    }
  }
  perms = (perms & ~deny) | allow
  const member = i.overwrites.find((o) => o.type === 1 && o.id === i.userId)
  if (member) perms = (perms & ~member.deny) | member.allow
  return perms
}

export const canViewChannel = (i: ViewInput): boolean => (effectivePermissions(i) & PERM_VIEW_CHANNEL) !== B(0)

export type ViewAccess = 'yes' | 'no' | 'unknown'

export interface PermOpts {
  botToken?: string
  guildId?: string
  fetchImpl?: typeof fetch
  now?: number
}

let rolesCache: { guildId: string; rolePerms: Map<string, bigint>; ownerId: string | null; at: number } | null = null
const channelCache = new Map<string, { overwrites: Overwrite[]; at: number }>()

export function clearPermissionCaches() {
  rolesCache = null
  channelCache.clear()
}

async function getJson(path: string, opts: PermOpts): Promise<{ ok: true; json: unknown } | { ok: false; status: number }> {
  const t = (opts.botToken ?? process.env.DISCORD_BOT_TOKEN ?? '').trim()
  if (!t) return { ok: false, status: 0 }
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${API}${path}`, { headers: { Authorization: `Bot ${t}` }, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return { ok: false, status: res.status }
    return { ok: true, json: await res.json() }
  } catch {
    return { ok: false, status: 0 }
  }
}

const big = (v: unknown): bigint => {
  try {
    return BigInt(String(v ?? '0'))
  } catch {
    return B(0)
  }
}

async function loadGuild(guildId: string, opts: PermOpts, now: number) {
  if (rolesCache && rolesCache.guildId === guildId && now - rolesCache.at < ROLES_TTL_MS) return rolesCache
  const [g, r] = await Promise.all([getJson(`/guilds/${guildId}`, opts), getJson(`/guilds/${guildId}/roles`, opts)])
  if (!g.ok || !r.ok || !Array.isArray(r.json)) return null
  const rolePerms = new Map<string, bigint>()
  for (const ro of r.json as Array<{ id: string; permissions?: string }>) rolePerms.set(String(ro.id), big(ro.permissions))
  const owner = (g.json as { owner_id?: string }).owner_id
  rolesCache = { guildId, rolePerms, ownerId: owner ? String(owner) : null, at: now }
  return rolesCache
}

async function loadOverwrites(channelId: string, opts: PermOpts, now: number): Promise<Overwrite[] | null> {
  const hit = channelCache.get(channelId)
  if (hit && now - hit.at < CHANNEL_TTL_MS) return hit.overwrites
  const r = await getJson(`/channels/${channelId}`, opts)
  if (!r.ok) return null
  const raw = (r.json as { permission_overwrites?: Array<{ id: string; type: number | string; allow?: string; deny?: string }> }).permission_overwrites ?? []
  const overwrites = raw.map((o) => ({ id: String(o.id), type: Number(o.type), allow: big(o.allow), deny: big(o.deny) }))
  channelCache.set(channelId, { overwrites, at: now })
  return overwrites
}

/**
 * Can this user view the channel? 'no' for someone not in the server or without the permission; 'unknown'
 * when Discord could not be asked (callers never treat that as a refusal).
 */
export async function userCanViewChannel(userId: string, channelId: string, opts: PermOpts = {}): Promise<ViewAccess> {
  const guildId = (opts.guildId ?? process.env.DISCORD_GUILD_ID ?? '').trim()
  if (!guildId || !SNOWFLAKE.test(userId) || !SNOWFLAKE.test(channelId)) return 'unknown'
  const now = opts.now ?? Date.now()
  const [guild, overwrites, member] = await Promise.all([loadGuild(guildId, opts, now), loadOverwrites(channelId, opts, now), getJson(`/guilds/${guildId}/members/${userId}`, opts)])
  if (!member.ok) return member.status === 404 ? 'no' : 'unknown'
  if (!guild || !overwrites) return 'unknown'
  const memberRoleIds = ((member.json as { roles?: string[] }).roles ?? []).map(String)
  return canViewChannel({ guildId, ownerId: guild.ownerId, userId, memberRoleIds, rolePerms: guild.rolePerms, overwrites }) ? 'yes' : 'no'
}
