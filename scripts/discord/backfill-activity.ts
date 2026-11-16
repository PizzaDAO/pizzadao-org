/**
 * Gap backfill for the profile "Discord activity" numbers (table DiscordActivity).
 *
 * The one-off history crawl covers messages up to its run; the recorder's live counter covers messages from
 * the moment it went live (it logs "discord activity: live counting began with a message at <ISO>"). This
 * counts what is in between, from the Discord REST API (message metadata only, no content is read or kept).
 *
 *   node scripts/discord/backfill-activity.ts --from <ISO> --until <ISO> [--out file.json]
 *       dry run (default): crawls and prints totals; writes nothing to the database.
 *   ... --apply
 *       crawls, then adds the counts. Each batch of members is applied once (stable batch ids derived from
 *       from/until), so a crashed apply can be resumed by running the SAME command again.
 *   ... --in file.json --apply
 *       applies a crawl saved earlier with --out (no new crawl; the safest way to resume).
 *
 *   --from   when the earlier crawl stopped (e.g. the lastSyncedAt of its rows). Required: guessing would
 *            double count or miss messages.
 *   --until  the first live-counted message time from the recorder log. Messages before it are counted here.
 *
 * Active days: each distinct day found counts as a new active day, except the --from day and the --until day (already
 * counted by the old crawl and the live counter). The member's stored name is never replaced.
 *
 * Needs DISCORD_BOT_TOKEN, DISCORD_GUILD_ID (and DATABASE_URL for --apply). The bot needs View Channel and
 * Read Message History; channels it cannot read are skipped. One request at a time with the rate-limit headers
 * and 429s honoured: about 100 messages per request. Run with Node 24. Do not run twice for the same window
 * with different data: counts are additive.
 */
import { register } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'

register('../members/alias-hooks.mjs', import.meta.url)

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const apply = process.argv.includes('--apply')
  const from = arg('from')
  const until = arg('until')
  const inFile = arg('in')
  const outFile = arg('out')
  if (!inFile && (!from || !until)) {
    console.error('--from <ISO> and --until <ISO> are required (or --in <saved crawl>)')
    process.exit(2)
  }
  const { crawlGap, toBatches } = await import('../../app/lib/discord-activity-backfill.ts')
  type Agg = Awaited<ReturnType<typeof crawlGap>>['aggregate']

  let aggregate: Agg
  let prefix: string
  let countedDays: string[]
  if (inFile) {
    const saved = JSON.parse(readFileSync(inFile, 'utf8')) as { prefix: string; users: Array<[string, unknown]>; countedDays: string[] }
    aggregate = new Map(saved.users) as Agg
    prefix = saved.prefix
    countedDays = saved.countedDays
    console.log(`loaded ${aggregate.size} members from ${inFile}`)
  } else {
    const fromMs = Date.parse(from!)
    const untilMs = Date.parse(until!)
    if (!Number.isFinite(fromMs) || !Number.isFinite(untilMs) || untilMs <= fromMs) {
      console.error('--from and --until must be ISO times, from before until')
      process.exit(2)
    }
    // Days the other two sources already counted as active: the old crawl's last day and the live counter's first day.
    countedDays = [...new Set([new Date(fromMs).toISOString().slice(0, 10), new Date(untilMs).toISOString().slice(0, 10)])]
    const token = process.env.DISCORD_BOT_TOKEN
    const guildId = process.env.DISCORD_GUILD_ID
    if (!token || !guildId) {
      console.error('DISCORD_BOT_TOKEN and DISCORD_GUILD_ID are required')
      process.exit(2)
    }
    const started = Date.now()
    const out = await crawlGap({ token, guildId, fromMs, untilMs, log: (m) => console.log(`${Math.round((Date.now() - started) / 1000)}s ${m}`) })
    aggregate = out.aggregate
    prefix = `backfill-${new Date(fromMs).toISOString().replace(/\D/g, '').slice(0, 14)}-${new Date(untilMs).toISOString().replace(/\D/g, '').slice(0, 14)}`
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', members: aggregate.size, ...out.stats, seconds: Math.round((Date.now() - started) / 1000) }, null, 2))
    if (outFile) writeFileSync(outFile, JSON.stringify({ prefix, countedDays, users: [...aggregate.entries()] }))
  }

  const batches = toBatches(aggregate, prefix)
  if (!apply) {
    console.log(`dry run: ${batches.length} batch(es) would be applied (prefix ${prefix}). Nothing written. Re-run with --apply.`)
    return
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set')
    process.exit(2)
  }
  const { applyActivityBatch } = await import('../../app/lib/discord-activity.ts')
  const { prisma } = await import('../../app/lib/db.ts')
  try {
    let applied = 0
    let duplicate = 0
    for (const b of batches) {
      const r = await applyActivityBatch(b, { backfill: true, countedDays })
      if (r.status === 'applied') applied++
      else duplicate++
      console.log(`batch ${b.batchId}: ${r.status}`)
    }
    console.log(JSON.stringify({ applied, alreadyApplied: duplicate }))
  } finally {
    await (prisma as { $disconnect?: () => Promise<void> }).$disconnect?.()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
