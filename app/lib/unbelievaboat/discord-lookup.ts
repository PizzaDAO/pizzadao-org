/**
 * Optional export step: annotate each UB user with Discord facts the
 * migration needs (is it a bot? still in the server? username for review).
 *
 *   GET /guilds/{guild}/members/{id}  200 -> in guild (user.bot, username)
 *                                     404 -> left the server; then
 *   GET /users/{id}                   200 -> bot flag + username
 *
 * Uses DISCORD_BOT_TOKEN (the app's existing bot). Read-only.
 */

export interface DiscordFacts {
  username: string | null
  bot: boolean | null
  inGuild: boolean | null
}

export interface DiscordLookupOptions {
  botToken: string
  guildId: string
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  maxAttempts?: number
  log?: (msg: string) => void
}

const API = 'https://discord.com/api/v10'
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export function createDiscordLookup(opts: DiscordLookupOptions) {
  const fetchImpl = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? defaultSleep
  const maxAttempts = opts.maxAttempts ?? 6
  const log = opts.log ?? (() => {})

  async function get(path: string): Promise<{ status: number; body: Record<string, unknown> | null }> {
    for (let attempt = 1; ; attempt++) {
      const res = await fetchImpl(API + path, { headers: { Authorization: `Bot ${opts.botToken}` } })
      if (res.status === 429 && attempt < maxAttempts) {
        let waitMs = 1000
        try {
          const b = (await res.json()) as { retry_after?: number }
          if (typeof b.retry_after === 'number') waitMs = Math.ceil(b.retry_after * 1000) // Discord: seconds
        } catch {
          /* HTML/Cloudflare body: fall back to 1s */
        }
        log(`discord 429 on ${path}; waiting ${waitMs}ms`)
        await sleep(waitMs + 50)
        continue
      }
      // Proactive: pause when the bucket is drained.
      if (res.headers.get('x-ratelimit-remaining') === '0') {
        const after = Number(res.headers.get('x-ratelimit-reset-after'))
        if (Number.isFinite(after) && after > 0) await sleep(Math.ceil(after * 1000))
      }
      if (res.status === 404) return { status: 404, body: null }
      if (!res.ok) throw new Error(`Discord ${res.status} on ${path}`)
      return { status: res.status, body: (await res.json()) as Record<string, unknown> }
    }
  }

  async function lookup(discordId: string): Promise<DiscordFacts> {
    const m = await get(`/guilds/${opts.guildId}/members/${discordId}`)
    if (m.status !== 404 && m.body) {
      const user = (m.body.user ?? {}) as { username?: string; bot?: boolean }
      return { username: user.username ?? null, bot: !!user.bot, inGuild: true }
    }
    const u = await get(`/users/${discordId}`)
    if (!u.body) return { username: null, bot: null, inGuild: false }
    return { username: (u.body.username as string) ?? null, bot: !!u.body.bot, inGuild: false }
  }

  async function lookupAll(ids: string[], onProgress?: (done: number, total: number) => void) {
    const out = new Map<string, DiscordFacts>()
    let i = 0
    for (const id of ids) {
      out.set(id, await lookup(id))
      onProgress?.(++i, ids.length)
    }
    return out
  }

  return { lookup, lookupAll }
}
