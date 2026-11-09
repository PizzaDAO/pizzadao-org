/**
 * Merge a duplicate member into the one to keep (app/lib/members/merge.ts).
 *
 *   node scripts/members/merge.ts --keep <memberId> --remove <memberId>
 *       dry run (default): prints the per-table report and writes nothing.
 *   ... --apply
 *       performs the merge in one transaction (re-points every member-id column, drops duplicates,
 *       sums PEP through the ledger, tombstones the removed member, writes an audit row).
 *   ... --json           print the report as JSON.
 *   ... --actor <name>   who is running it, for the audit row (default: cli).
 *
 * Needs DATABASE_URL. Run with Node 24 (it strips the TypeScript types itself).
 */
import { register } from 'node:module'

register('./alias-hooks.mjs', import.meta.url)

function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++ } else out[key] = true
  }
  return out
}

async function main() {
  const a = parseArgs(process.argv.slice(2))
  const keepId = typeof a.keep === 'string' ? a.keep : ''
  const removeId = typeof a.remove === 'string' ? a.remove : ''
  if (!keepId || !removeId) {
    console.error('Usage: node scripts/members/merge.ts --keep <memberId> --remove <memberId> [--apply] [--json] [--actor <name>]')
    process.exit(2)
  }
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set'); process.exit(2) }

  const { mergeMembers } = await import('../../app/lib/members/merge.ts')
  const { prisma } = await import('../../app/lib/db.ts')
  const apply = a.apply === true
  try {
    const report = await mergeMembers({ keepId, removeId, dryRun: !apply, actor: typeof a.actor === 'string' ? a.actor : 'cli' }, { prisma })
    if (a.json === true) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log(`${apply ? 'APPLIED' : 'DRY RUN'}: merge ${removeId} into ${keepId}`)
      for (const t of report.tables) {
        if (!t.moved && !t.dropped) continue
        console.log(`  ${t.table}.${t.column}: move ${t.moved}, drop ${t.dropped}`)
        for (const c of t.collisions) console.log(`      collision: ${c}`)
      }
      console.log(`  discord: ${report.discord.action} (keep ${report.discord.keepDiscordId ?? '-'}, remove ${report.discord.removeDiscordId ?? '-'})`)
      if (report.pep) console.log(`  PEP: ${report.pep.moved} from ${report.pep.fromDiscordId} to ${report.pep.toDiscordId}`)
      for (const n of report.notes) console.log(`  note: ${n}`)
      console.log(`  totals: ${report.totals.moved} moved, ${report.totals.dropped} dropped, ${report.totals.collisions} collisions`)
      if (!apply) console.log('Nothing was written. Re-run with --apply to merge.')
    }
  } finally {
    await (prisma as { $disconnect?: () => Promise<void> }).$disconnect?.()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
