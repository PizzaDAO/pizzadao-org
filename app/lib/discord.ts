import { parseRateLimit } from "./discord-rest"

// Discord bot credentials. When DISCORD_GUILD_ID or DISCORD_BOT_TOKEN is
// unset (local dev, previews), every lookup short-circuits to "unknown / not a
// member" instead of calling e.g. `guilds//members/<id>` with an empty ID.
let warnedMissingDiscordConfig = false

function warnMissingDiscordConfig(missing: string[]) {
  if (warnedMissingDiscordConfig) return
  warnedMissingDiscordConfig = true
  console.warn(`[discord] ${missing.join(" and ")} not set; skipping Discord API calls`)
}

function guildConfig(): { guildId: string; botToken: string } | null {
  const guildId = process.env.DISCORD_GUILD_ID
  const botToken = process.env.DISCORD_BOT_TOKEN
  if (!guildId || !botToken) {
    const missing: string[] = []
    if (!guildId) missing.push("DISCORD_GUILD_ID")
    if (!botToken) missing.push("DISCORD_BOT_TOKEN")
    warnMissingDiscordConfig(missing)
    return null
  }
  return { guildId, botToken }
}

function botTokenOnly(): string | null {
  const botToken = process.env.DISCORD_BOT_TOKEN
  if (!botToken) {
    warnMissingDiscordConfig(["DISCORD_BOT_TOKEN"])
    return null
  }
  return botToken
}

// Fetch guild member data including roles
export async function fetchGuildMember(userId: string) {
  const cfg = guildConfig()
  if (!cfg) return null
  const { guildId, botToken } = cfg

  const r = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, {
    headers: { Authorization: `Bot ${botToken}` },
    next: { revalidate: 60 }, // Cache for 1 minute
  })

  if (!r.ok) return null
  return await r.json() as {
    nick?: string
    roles: string[]
    user?: { id: string; username: string; global_name?: string }
  }
}

export type GuildMembership =
  | { status: "member"; member: NonNullable<Awaited<ReturnType<typeof fetchGuildMember>>> }
  | { status: "not_member" }
  | { status: "unknown" }

/**
 * Uncached guild-membership check via the bot (used at login, where a stale
 * cached "not a member" would send people through the join step needlessly).
 * "unknown" means the Discord API call itself failed (not a 404).
 */
export async function lookupGuildMembership(userId: string): Promise<GuildMembership> {
  const cfg = guildConfig()
  if (!cfg) return { status: "unknown" }
  const { guildId, botToken } = cfg
  try {
    const r = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, {
      headers: { Authorization: `Bot ${botToken}` },
      cache: "no-store",
    })
    if (r.ok) {
      const member = await r.json() as NonNullable<Awaited<ReturnType<typeof fetchGuildMember>>>
      return { status: "member", member }
    }
    if (r.status === 404) return { status: "not_member" }
    return { status: "unknown" }
  } catch {
    return { status: "unknown" }
  }
}

// Check if user has any of the specified roles
export async function hasAnyRole(userId: string, roleIds: readonly string[]): Promise<boolean> {
  const member = await fetchGuildMember(userId)
  if (!member) return false
  return member.roles.some(role => roleIds.includes(role))
}

// Check if user has a specific role
export async function hasRole(userId: string, roleId: string): Promise<boolean> {
  const member = await fetchGuildMember(userId)
  if (!member) return false
  return member.roles.includes(roleId)
}

// Get user's roles
export async function getUserRoles(userId: string): Promise<string[]> {
  const member = await fetchGuildMember(userId)
  return member?.roles ?? []
}

// Search guild members by username query
export async function searchGuildMembers(query: string, limit = 5) {
  const cfg = guildConfig()
  if (!cfg) return []
  const { guildId, botToken } = cfg

  const r = await fetch(
    `https://discord.com/api/v10/guilds/${guildId}/members/search?query=${encodeURIComponent(query)}&limit=${limit}`,
    { headers: { Authorization: `Bot ${botToken}` }, cache: "no-store" },
  )

  if (!r.ok) return []
  return await r.json() as Array<{
    nick?: string
    roles: string[]
    user: { id: string; username: string; global_name?: string }
  }>
}

// Get Discord IDs of all members who have any of the specified roles (cached 10 min)
let membersByRoleCache: { key: string; ids: string[]; timestamp: number } | null = null
const MEMBERS_BY_ROLE_TTL = 10 * 60 * 1000

export async function getMembersWithRoles(roleIds: readonly string[]): Promise<string[]> {
  const key = [...roleIds].sort().join(',')
  if (membersByRoleCache && membersByRoleCache.key === key && Date.now() - membersByRoleCache.timestamp < MEMBERS_BY_ROLE_TTL) {
    return membersByRoleCache.ids
  }

  const cfg = guildConfig()
  if (!cfg) return []
  const { guildId, botToken } = cfg
  const ids: string[] = []
  let after = '0'

  // Paginate through guild members (1000 per page)
  for (let page = 0; page < 10; page++) {
    const r = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members?limit=1000&after=${after}`,
      { headers: { Authorization: `Bot ${botToken}` }, cache: 'no-store' }
    )
    if (!r.ok) break
    const members = await r.json() as Array<{ roles: string[]; user: { id: string } }>
    if (members.length === 0) break

    for (const m of members) {
      if (m.roles.some(r => roleIds.includes(r))) {
        ids.push(m.user.id)
      }
    }

    after = members[members.length - 1].user.id
    if (members.length < 1000) break
  }

  membersByRoleCache = { key, ids, timestamp: Date.now() }
  return ids
}

// Send a DM to a Discord user via the bot
export async function sendDM(
  userId: string,
  content: string,
  extra: { embeds?: unknown[] } = {},
): Promise<{ success: boolean; error?: string }> {
  const botToken = botTokenOnly()
  if (!botToken) return { success: false, error: "discord_not_configured" }

  // Step 1: Create/open DM channel
  const chanRes = await fetch("https://discord.com/api/v10/users/@me/channels", {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ recipient_id: userId }),
  })

  if (!chanRes.ok) {
    const err = await chanRes.text()
    if (chanRes.status === 403) {
      return { success: false, error: "dms_disabled" }
    }
    return { success: false, error: `dm_channel_failed: ${err}` }
  }

  const channel = (await chanRes.json()) as { id: string }

  // Step 2: Send message
  const msgRes = await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(extra.embeds?.length ? { content, embeds: extra.embeds, allowed_mentions: { parse: [] } } : { content }),
  })

  if (!msgRes.ok) {
    const err = await msgRes.text()
    if (msgRes.status === 403) {
      return { success: false, error: "dms_disabled" }
    }
    return { success: false, error: `dm_send_failed: ${err}` }
  }

  return { success: true }
}

// ------------------------------------------------------------ display names ---

/** What a person is called in the guild: nickname, global display name, username, avatar. */
export type GuildMemberProfile = {
  id: string
  nick: string | null
  globalName: string | null
  username: string | null
  avatarUrl: string | null
}

const PROFILE_TTL_MS = 60 * 60 * 1000
const PROFILE_MISS_TTL_MS = 10 * 60 * 1000
const PROFILE_CACHE_MAX = 5000
const profileCache = new Map<string, { profile: GuildMemberProfile | null; at: number }>()

export function clearGuildMemberProfileCache() {
  profileCache.clear()
}

function avatarUrlFor(
  guildId: string,
  m: { avatar?: string | null; user?: { id: string; avatar?: string | null } },
): string | null {
  const uid = m.user?.id
  if (!uid) return null
  if (m.avatar) return `https://cdn.discordapp.com/guilds/${guildId}/users/${uid}/avatars/${m.avatar}.png?size=64`
  if (m.user?.avatar) return `https://cdn.discordapp.com/avatars/${uid}/${m.user.avatar}.png?size=64`
  return null
}

/**
 * A guild member's display names via the bot, cached in memory for an hour
 * (a "not in the guild" answer for 10 minutes). Returns null when the person
 * isn't in the guild, Discord isn't configured, or the call fails or times out
 * (a failure is not cached). Used to label people who aren't in the Crew sheet.
 */
export async function fetchGuildMemberProfile(
  userId: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch; now?: number } = {},
): Promise<GuildMemberProfile | null> {
  if (!/^\d{5,25}$/.test(userId)) return null
  const now = opts.now ?? Date.now()
  const hit = profileCache.get(userId)
  if (hit && now - hit.at < (hit.profile ? PROFILE_TTL_MS : PROFILE_MISS_TTL_MS)) return hit.profile

  const cfg = guildConfig()
  if (!cfg) return null
  const { guildId, botToken } = cfg
  try {
    const r = await (opts.fetchImpl ?? fetch)(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, {
      headers: { Authorization: `Bot ${botToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 1500),
    })
    let profile: GuildMemberProfile | null = null
    if (r.ok) {
      const m = (await r.json()) as {
        nick?: string | null
        avatar?: string | null
        user?: { id: string; username?: string; global_name?: string | null; avatar?: string | null }
      }
      profile = {
        id: userId,
        nick: m.nick?.trim() || null,
        globalName: m.user?.global_name?.trim() || null,
        username: m.user?.username?.trim() || null,
        avatarUrl: avatarUrlFor(guildId, m),
      }
    } else if (r.status !== 404) {
      return hit?.profile ?? null // transient failure: keep any stale answer, cache nothing
    }
    if (profileCache.size >= PROFILE_CACHE_MAX) profileCache.clear()
    profileCache.set(userId, { profile, at: now })
    return profile
  } catch {
    return hit?.profile ?? null
  }
}

// ---------------------------------------------------------------------------
// Trainee nickname enforcement (anchovy-52918)
// ---------------------------------------------------------------------------

export interface GuildMemberRow {
  nick?: string | null
  roles: string[]
  joined_at?: string | null
  user: { id: string; bot?: boolean; username?: string }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Every guild member, 1000 per page. Unlike getMembersWithRoles this THROWS on
 * any non-OK response (a partial list would make enforcement decisions on
 * missing data). A 429 is waited out once per page when the wait is short.
 * Needs the GUILD_MEMBERS privileged intent.
 */
export async function listAllGuildMembers(
  opts: { maxPages?: number; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
): Promise<GuildMemberRow[]> {
  const cfg = guildConfig()
  if (!cfg) throw new Error("Discord is not configured")
  const { guildId, botToken } = cfg
  const doFetch = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? defaultSleep
  const maxPages = opts.maxPages ?? 200
  const all: GuildMemberRow[] = []
  let after = "0"

  for (let page = 0; page < maxPages; page++) {
    const url = `https://discord.com/api/v10/guilds/${guildId}/members?limit=1000&after=${after}`
    const init = { headers: { Authorization: `Bot ${botToken}` }, cache: "no-store" as const }
    let r = await doFetch(url, init)
    if (r.status === 429) {
      const { retryAfterMs, cloudflare } = parseRateLimit(r.headers, await r.text())
      if (cloudflare || retryAfterMs === null || retryAfterMs > 15_000) {
        throw new Error("Discord member list rate limited")
      }
      await sleep(retryAfterMs)
      r = await doFetch(url, init)
    }
    if (!r.ok) throw new Error(`Discord member list failed (${r.status})`)
    const members = (await r.json()) as GuildMemberRow[]
    if (members.length === 0) break
    all.push(...members)
    after = members[members.length - 1].user.id
    if (members.length < 1000) break
  }
  return all
}

export interface GuildInfo {
  ownerId: string | null
  systemChannelId?: string | null
  roles: Array<{ id: string; name: string; position: number; managed: boolean }>
}

/** Owner and roles (with position / managed) from GET /guilds/{id}. Throws on failure. */
export async function getGuildInfo(opts: { fetchImpl?: typeof fetch } = {}): Promise<GuildInfo> {
  const cfg = guildConfig()
  if (!cfg) throw new Error("Discord is not configured")
  const doFetch = opts.fetchImpl ?? fetch
  const r = await doFetch(`https://discord.com/api/v10/guilds/${cfg.guildId}`, {
    headers: { Authorization: `Bot ${cfg.botToken}` },
    cache: "no-store",
  })
  if (!r.ok) throw new Error(`Discord guild fetch failed (${r.status})`)
  const g = (await r.json()) as {
    owner_id?: string
    system_channel_id?: string | null
    roles?: Array<{ id: string; name?: string; position?: number; managed?: boolean }>
  }
  return {
    ownerId: g.owner_id ? String(g.owner_id) : null,
    systemChannelId: g.system_channel_id ? String(g.system_channel_id) : null,
    roles: (g.roles ?? []).map((ro) => ({
      id: String(ro.id),
      name: String(ro.name ?? ""),
      position: Number(ro.position ?? 0),
      managed: !!ro.managed,
    })),
  }
}

/** The bot's own user id (GET /users/@me). Throws on failure. */
export async function getBotUserId(opts: { fetchImpl?: typeof fetch } = {}): Promise<string> {
  const botToken = botTokenOnly()
  if (!botToken) throw new Error("Discord is not configured")
  const doFetch = opts.fetchImpl ?? fetch
  const r = await doFetch("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bot ${botToken}` },
    cache: "no-store",
  })
  if (!r.ok) throw new Error(`Discord @me failed (${r.status})`)
  return String(((await r.json()) as { id: string }).id)
}

export type MemberWrite =
  | { kind: "nick"; userId: string; nick: string | null }
  | { kind: "addRole"; userId: string; roleId: string }
  | { kind: "removeRole"; userId: string; roleId: string }

export interface MemberWriteResult {
  status: number
  /** X-RateLimit-Remaining / Reset-After (ms) when Discord sent them. */
  remaining: number | null
  resetAfterMs: number | null
  /** On a 429: the wait, and whether it is a Cloudflare / global block. */
  retryAfterMs: number | null
  blocked: boolean
}

/**
 * One guild-member write. A nickname is a PATCH with ONLY `nick` (never
 * `roles`); a role add is PUT .../roles/{id} and a removal is DELETE
 * .../roles/{id}, both idempotent single-role calls that can't race other role
 * edits. Never throws on an HTTP error: the caller decides what to do.
 */
export async function writeGuildMember(
  op: MemberWrite,
  reason: string,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<MemberWriteResult> {
  const cfg = guildConfig()
  if (!cfg) throw new Error("Discord is not configured")
  const doFetch = opts.fetchImpl ?? fetch
  const base = `https://discord.com/api/v10/guilds/${cfg.guildId}/members/${op.userId}`
  const headers: Record<string, string> = {
    Authorization: `Bot ${cfg.botToken}`,
    "X-Audit-Log-Reason": encodeURIComponent(reason),
  }
  let url = base
  let method = "PATCH"
  let body: string | undefined
  if (op.kind === "nick") {
    headers["Content-Type"] = "application/json"
    body = JSON.stringify({ nick: op.nick })
  } else {
    url = `${base}/roles/${op.roleId}`
    method = op.kind === "addRole" ? "PUT" : "DELETE"
  }
  const r = await doFetch(url, { method, headers, body, cache: "no-store" })
  const num = (h: string) => {
    const v = r.headers.get(h)
    return v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null
  }
  const resetAfter = num("x-ratelimit-reset-after")
  let retryAfterMs: number | null = null
  let blocked = false
  if (r.status === 429) {
    const text = await r.text()
    const rl = parseRateLimit(r.headers, text)
    retryAfterMs = rl.retryAfterMs
    let global = false
    try { global = !!(JSON.parse(text) as { global?: boolean }).global } catch { /* not JSON */ }
    blocked = rl.cloudflare || global || r.headers.get("x-ratelimit-global") !== null
  }
  return {
    status: r.status,
    remaining: num("x-ratelimit-remaining"),
    resetAfterMs: resetAfter === null ? null : Math.ceil(resetAfter * 1000),
    retryAfterMs,
    blocked,
  }
}

export const addGuildMemberRole = (userId: string, roleId: string, reason: string) =>
  writeGuildMember({ kind: "addRole", userId, roleId }, reason)
export const removeGuildMemberRole = (userId: string, roleId: string, reason: string) =>
  writeGuildMember({ kind: "removeRole", userId, roleId }, reason)

export interface WelcomeResult {
  /** 'closed' = Discord error 50007 (the member blocks DMs from this server). */
  dm: "sent" | "closed" | "failed"
  channel: "sent" | "skipped" | "failed"
  /** True when a leg failed with a 5xx, a still-429 after the retry, a timeout or a network error. */
  transient: boolean
  /** True when a leg got a 429 that was not retried (wait over the cap) or was still 429 after the retry. */
  rateLimited: boolean
}

/**
 * Worst case for one welcome: 3 requests x 5s timeout + one 3s 429 wait + one
 * retried request of 5s = ~23s. The runner starts a welcome only before 85s of
 * the run, so it ends by ~108s, inside the 115s lock transaction.
 */
const WELCOME_TIMEOUT_MS = 5000
const WELCOME_MAX_429_WAIT_MS = 3000

/**
 * oregano-41907: welcome one member by DM and, when channelId is given, by an
 * @mention post limited to that one user. Never throws on HTTP errors; each
 * leg reports its own outcome so one failing never blocks the other. A 429 is
 * retried once after Retry-After (capped at 3s). Every fetch has a 5s timeout.
 */
export async function sendWelcome(
  userId: string,
  text: string,
  channelId: string | null,
  opts: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
): Promise<WelcomeResult> {
  const botToken = botTokenOnly()
  if (!botToken) throw new Error("Discord is not configured")
  const doFetch = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const headers = { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" }
  const api = "https://discord.com/api/v10"
  let transient = false
  let rateLimited = false

  const send = (url: string, body: unknown) =>
    doFetch(url, { method: "POST", headers, body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(WELCOME_TIMEOUT_MS) })
  /** POST with one 429 retry. Throws on network error / timeout. */
  const post = async (url: string, body: unknown): Promise<Response> => {
    let r = await send(url, body)
    if (r.status === 429) {
      const text429 = await r.text()
      const rl = parseRateLimit(r.headers, text429)
      if (rl.cloudflare || rl.retryAfterMs === null || rl.retryAfterMs > WELCOME_MAX_429_WAIT_MS) return r
      await sleep(rl.retryAfterMs)
      r = await send(url, body)
    }
    return r
  }
  const note = (r: Response, leg: string) => {
    console.warn(`[welcome] ${leg} failed for ${userId}: HTTP ${r.status}`)
    if (r.status === 429) rateLimited = true
    if (r.status === 429 || r.status >= 500) transient = true
  }

  const out: WelcomeResult = { dm: "failed", channel: channelId ? "failed" : "skipped", transient: false, rateLimited: false }
  try {
    const ch = await post(`${api}/users/@me/channels`, { recipient_id: userId })
    if (ch.ok) {
      const dmId = String(((await ch.json()) as { id: string }).id)
      const m = await post(`${api}/channels/${dmId}/messages`, { content: text })
      if (m.ok) out.dm = "sent"
      else if (await isDmClosed(m)) out.dm = "closed"
      else note(m, "DM")
    } else if (await isDmClosed(ch)) out.dm = "closed"
    else note(ch, "DM channel")
  } catch (e) {
    transient = true
    console.warn("[welcome] DM failed", (e as Error)?.message)
  }
  if (channelId) {
    try {
      const m = await post(`${api}/channels/${channelId}/messages`, {
        content: `<@${userId}> ${text}`,
        allowed_mentions: { parse: [], users: [userId] },
      })
      if (m.ok) out.channel = "sent"
      else note(m, "channel post")
    } catch (e) {
      transient = true
      console.warn("[welcome] channel post failed", (e as Error)?.message)
    }
  }
  out.transient = transient
  out.rateLimited = rateLimited
  return out
}

async function isDmClosed(r: Response): Promise<boolean> {
  try {
    return (JSON.parse(await r.text()) as { code?: number }).code === 50007
  } catch {
    return false
  }
}
