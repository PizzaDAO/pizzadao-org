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
