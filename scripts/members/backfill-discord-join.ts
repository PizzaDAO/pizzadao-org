/**
 * Backfill each member's Discord server join date (MemberProfileExtras.discordJoinedAt), which the
 * profile and hover card use for "member since" (app/lib/member-since.ts).
 *
 *   node scripts/members/backfill-discord-join.ts
 *       dry run (default): reads the guild member list and prints what it would write.
 *   ... --apply
 *       writes it. Idempotent: a member is only written when they have no stored date or
 *       Discord's date is earlier, so re-running changes nothing.
 *
 * Rate friendly: one paginated guild member list (1000 per request, a 429 is waited out) instead of
 * a lookup per member. Needs DATABASE_URL, DISCORD_BOT_TOKEN, DISCORD_GUILD_ID and the bot's
 * GUILD_MEMBERS intent. Maps Discord ids to member ids through the Member table (sheets.source.members = db);
 * members it cannot map are filled on their first profile view instead. Run with Node 24.
 */
import { register } from 'node:module'

register('./alias-hooks.mjs', import.meta.url)

async function main() {
  const apply = process.argv.includes('--apply')
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set'); process.exit(2) }

  const { listAllGuildMembers } = await import('../../app/lib/discord.ts')
  const { backfillDiscordJoinedAt } = await import('../../app/lib/member-since.ts')
  const { prisma } = await import('../../app/lib/db.ts')
  try {
    const members = await prisma.member.findMany({
      where: { discordId: { not: null }, mergedInto: null },
      select: { id: true, discordId: true },
    })
    const byDiscord = new Map<string, string>()
    for (const m of members) if (m.discordId) byDiscord.set(m.discordId, m.id)

    const guild = await listAllGuildMembers()
    const rows = guild.flatMap((g) => {
      const memberId = byDiscord.get(g.user.id)
      return memberId ? [{ memberId, discordId: g.user.id, joinedAt: g.joined_at }] : []
    })
    console.log(`${guild.length} guild members, ${members.length} site members, ${rows.length} matched`)
    const result = await backfillDiscordJoinedAt(rows, { apply })
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...result }, null, 2))
  } finally {
    await (prisma as { $disconnect?: () => Promise<void> }).$disconnect?.()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
