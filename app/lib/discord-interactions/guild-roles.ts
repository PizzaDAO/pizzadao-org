/**
 * Guild role list (id + name), used to resolve /collect-income role names to
 * ids. Cached in memory per server instance for an hour; on a failed refresh
 * the stale list is kept. Returns null when there's no bot token or the very
 * first fetch fails (role income then only pays roles with a configured id).
 */
const TTL_MS = 60 * 60 * 1000
const TIMEOUT_MS = 1500

type Role = { id: string; name: string }
let cache: { guildId: string; roles: Role[]; at: number } | null = null

export function clearGuildRolesCache() {
  cache = null
}

export async function getGuildRoles(
  guildId: string,
  opts: { botToken?: string; fetchImpl?: typeof fetch; now?: number } = {},
): Promise<Role[] | null> {
  const now = opts.now ?? Date.now()
  if (cache && cache.guildId === guildId && now - cache.at < TTL_MS) return cache.roles
  const token = (opts.botToken ?? process.env.DISCORD_BOT_TOKEN ?? '').trim()
  if (!token) return cache?.guildId === guildId ? cache.roles : null
  try {
    const res = await (opts.fetchImpl ?? fetch)(`https://discord.com/api/v10/guilds/${guildId}/roles`, {
      headers: { Authorization: `Bot ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`Discord ${res.status}`)
    const roles = ((await res.json()) as Role[]).map((r) => ({ id: String(r.id), name: String(r.name) }))
    cache = { guildId, roles, at: now }
    return roles
  } catch (err) {
    console.warn('[guild-roles] fetch failed:', err instanceof Error ? err.message : err)
    return cache?.guildId === guildId ? cache.roles : null
  }
}
