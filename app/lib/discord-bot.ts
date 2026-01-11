// Discord bot utilities for fetching role members

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID

interface GuildMember {
  user: {
    id: string
    username: string
  }
  roles: string[]
  nick?: string
}

/**
 * Fetch all members with a specific Discord role
 */
export async function getRoleMembers(roleId: string): Promise<string[]> {
  if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) {
    throw new Error('Discord bot not configured')
  }

  const members: string[] = []
  let after: string | undefined

  // Paginate through all guild members
  while (true) {
    const url = new URL(`https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members`)
    url.searchParams.set('limit', '1000')
    if (after) {
      url.searchParams.set('after', after)
    }

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      },
    })

    if (!res.ok) {
      const error = await res.text()
      throw new Error(`Discord API error: ${res.status} ${error}`)
    }

    const batch: GuildMember[] = await res.json()
    if (batch.length === 0) break

    // Filter members with the role
    for (const member of batch) {
      if (member.roles.includes(roleId)) {
        members.push(member.user.id)
      }
    }

    // Set up next page
    after = batch[batch.length - 1].user.id

    // If we got less than 1000, we're done
    if (batch.length < 1000) break
  }

  return members
}

/**
 * Fetch roles for a specific user
 */
export async function getUserRoles(discordId: string): Promise<string[]> {
  if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID) {
    throw new Error('Discord bot not configured')
  }

  const res = await fetch(
    `https://discord.com/api/v10/guilds/${DISCORD_GUILD_ID}/members/${discordId}`,
    {
      headers: {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      },
    }
  )

  if (!res.ok) {
    if (res.status === 404) {
      return [] // User not in guild
    }
    const error = await res.text()
    throw new Error(`Discord API error: ${res.status} ${error}`)
  }

  const member: GuildMember = await res.json()
  return member.roles
}
