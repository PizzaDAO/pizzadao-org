// Fetch guild member data including roles
export async function fetchGuildMember(userId: string) {
  const guildId = process.env.DISCORD_GUILD_ID!
  const botToken = process.env.DISCORD_BOT_TOKEN!

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
  const guildId = process.env.DISCORD_GUILD_ID!
  const botToken = process.env.DISCORD_BOT_TOKEN!

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

  const guildId = process.env.DISCORD_GUILD_ID!
  const botToken = process.env.DISCORD_BOT_TOKEN!
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
): Promise<{ success: boolean; error?: string }> {
  const botToken = process.env.DISCORD_BOT_TOKEN!

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
    body: JSON.stringify({ content }),
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
