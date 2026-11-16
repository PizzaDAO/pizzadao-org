/**
 * Read-only check of the channel-name key mapping used by the Discord activity block (app/lib/discord-activity.ts
 * channelKey). Prints only COUNTS: how many distinct stored topChannels keys (from DiscordActivity) map to exactly
 * one / no / several live guild channels. Keys with no live channel are mostly threads and forum posts (the old
 * crawl stored those as channels) or deleted channels; they are never shown publicly.
 *
 *   node scripts/discord/verify-channel-keys.ts
 *
 * Needs DATABASE_URL (read only), DISCORD_BOT_TOKEN, DISCORD_GUILD_ID. Writes nothing. Run with Node 24.
 */
import { register } from 'node:module'

register('../members/alias-hooks.mjs', import.meta.url)

async function main() {
  const token = process.env.DISCORD_BOT_TOKEN
  const guildId = process.env.DISCORD_GUILD_ID
  if (!token || !guildId || !process.env.DATABASE_URL) {
    console.error('DATABASE_URL, DISCORD_BOT_TOKEN and DISCORD_GUILD_ID are required')
    process.exit(2)
  }
  const { prisma } = await import('../../app/lib/db.ts')
  const { channelKey, readTopChannels } = await import('../../app/lib/discord-activity.ts')
  const { countKeyMatches } = await import('../../app/lib/discord-activity-public.ts')
  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, { headers: { Authorization: `Bot ${token}` } })
    if (!res.ok) throw new Error(`Discord answered ${res.status}`)
    const live = ((await res.json()) as Array<{ name?: string; type: number }>).filter((c) => c.name && [0, 2, 5, 13, 15, 16].includes(c.type)).map((c) => c.name!)
    const rows = await prisma.discordActivity.findMany({ select: { topChannels: true } })
    const keys = new Set<string>()
    for (const r of rows) for (const c of readTopChannels(r.topChannels)) keys.add(channelKey(c.name))
    console.log(JSON.stringify({ storedKeys: keys.size, liveChannels: live.length, ...countKeyMatches(keys, live) }, null, 2))
  } finally {
    await (prisma as { $disconnect?: () => Promise<void> }).$disconnect?.()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
