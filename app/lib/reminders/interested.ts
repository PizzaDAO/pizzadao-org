/**
 * The members who marked a Discord scheduled event "Interested" (GET /guilds/{guild}/scheduled-events/{id}/users).
 * Used for "calls I'm attending": the reminders include a due call the member is interested in even when it is
 * not one of their crews. Throws on any failure; the caller falls back to crews only.
 */
const API = 'https://discord.com/api/v10'
const PAGE = 100
/** A guild event with this many interested members is far beyond ours; stop paging there. */
const MAX_PAGES = 20

export async function fetchInterestedUserIds(
  eventId: string,
  o: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {},
): Promise<Set<string>> {
  const env = o.env ?? process.env
  const token = env.DISCORD_BOT_TOKEN?.trim()
  const guild = env.DISCORD_GUILD_ID?.trim()
  if (!token || !guild) throw new Error('DISCORD_BOT_TOKEN / DISCORD_GUILD_ID not configured')
  const out = new Set<string>()
  let after: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const qs: string = `limit=${PAGE}${after ? `&after=${after}` : ''}`
    const res: Response = await (o.fetchImpl ?? fetch)(`${API}/guilds/${guild}/scheduled-events/${encodeURIComponent(eventId)}/users?${qs}`, {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`Discord event users HTTP ${res.status}`)
    const rows = (await res.json()) as Array<{ user?: { id?: string } }>
    for (const r of rows) if (r.user?.id) out.add(String(r.user.id))
    if (rows.length < PAGE) break
    after = rows[rows.length - 1]?.user?.id ?? null
    if (!after) break
  }
  return out
}
