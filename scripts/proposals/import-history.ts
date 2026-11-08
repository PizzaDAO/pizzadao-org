/**
 * Import the proposal history (plans/proposals-history-import.md).
 *
 *   node scripts/proposals/import-history.ts \
 *     --inventory <inventory.json> --raw <proposals-raw.json> --early <discord.json> --sheet <sheet.json> \
 *     --eras <eras.json> --finance <matches.jsonl> --overrides <overrides.json> \
 *     [--members <members.json|jsonl>] [--sheet-url <url>] [--out <dir>] [--db]
 *       dry run (default): writes nothing to the database; prints totals and writes review files to --out.
 *   ... --apply --confirm <rowCount>
 *       writes the rows. Needs DATABASE_URL. Refuses unless <rowCount> equals the number of rows built.
 *
 * Every input file is private data and is passed by path; none of it belongs in the repository. Run with Node 24
 * (it strips the TypeScript types itself). The import is idempotent: rows upsert by importKey, links and payments
 * by (proposalId, sourceKey), and rows with source = APP are never touched.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { buildImport, summarize, type ImportInputs, type ImportRow, type RowOverride } from '../../app/lib/proposals/history-import.ts'

function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true
    else { out[a.slice(2)] = next; i++ }
  }
  return out
}

const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'))
const readLines = (p: string) => readFileSync(p, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => JSON.parse(l))

function need(a: Record<string, string | true>, k: string): string {
  const v = a[k]
  if (typeof v !== 'string') { console.error(`Missing --${k} <path>`); process.exit(2) }
  return v
}

function loadMembers(p: string | undefined): Array<{ discordId: string; name: string }> {
  if (!p) return []
  const text = readFileSync(p, 'utf8').trim()
  const list: Array<Record<string, unknown>> = text.startsWith('[') ? JSON.parse(text) : text.split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const seen = new Set<string>()
  const out: Array<{ discordId: string; name: string }> = []
  for (const m of list) {
    const discordId = String(m.discordId ?? m.discord_id ?? '')
    const name = String(m.name ?? '')
    if (!/^\d{15,25}$/.test(discordId) || !name || seen.has(`${discordId}|${name}`)) continue
    seen.add(`${discordId}|${name}`)
    out.push({ discordId, name })
  }
  return out
}

function table(label: string, items: Array<{ key: string; title: string; date: string | null; detail: string }>): string {
  const lines = [`## ${label} (${items.length})`, '']
  for (const i of items) lines.push(`- ${i.date ?? '?'} | ${i.key} | ${i.title} | ${i.detail}`)
  return lines.join('\n') + '\n'
}

async function main() {
  const a = parseArgs(process.argv.slice(2))
  const inventory = readJson(need(a, 'inventory'))
  const discord = readJson(need(a, 'early'))
  const inputs: ImportInputs = {
    inventory: inventory.proposals ?? [],
    early: inventory.preSheetCandidates ?? [],
    raw: readJson(need(a, 'raw')),
    earlyMessages: Array.isArray(discord) ? discord : (discord.messages ?? []),
    sheet: readJson(need(a, 'sheet')).Sheet1 ?? [],
    eras: readJson(need(a, 'eras')),
    finance: readLines(need(a, 'finance')),
    overrides: (a.overrides ? readJson(need(a, 'overrides')) : {}) as Record<string, RowOverride>,
    members: loadMembers(typeof a.members === 'string' ? a.members : undefined),
    guildId: String(inventory.meta?.guild ?? ''),
    channelId: String(inventory.meta?.channel ?? ''),
    sheetUrl: typeof a['sheet-url'] === 'string' ? a['sheet-url'] : null,
  }
  const result = buildImport(inputs)
  const summary = summarize(result.rows)
  const outDir = typeof a.out === 'string' ? a.out : '.'
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'dry-run-summary.json'), JSON.stringify({ summary, errors: result.errors }, null, 2))
  writeFileSync(join(outDir, 'dry-run-rows.json'), JSON.stringify(result.rows, null, 2))
  const r = result.review
  writeFileSync(
    join(outDir, 'dry-run-review.md'),
    [
      '# Proposals import: review list (private)\n',
      table('Still unresolved (Result not recorded)', r.unresolved),
      table('Conflicts (counts vs sheet)', r.conflicts),
      table('Unended or ambiguous polls', r.unendedOrAmbiguous),
      table('Polls with no stated quorum', r.noQuorum),
      table('Non-USD or raw amounts', r.nonUsdAmounts),
      table('Unmatched proposers (shown as written)', r.unmatchedProposers),
      table('Payment warnings', r.paymentWarnings),
      table('Medium-confidence payments (NOT imported)', r.mediumPayments),
      table('Low or untagged payments (NOT imported)', r.lowPayments),
      table('Finance lines that matched no proposal', r.unmatchedFinance),
      table('Sheet rows reattached by override', r.reattachedSheetRows),
    ].join('\n'),
  )
  console.log(JSON.stringify(summary, null, 2))
  console.log(`review: ${join(outDir, 'dry-run-review.md')}`)
  if (result.errors.length) {
    console.error(`\n${result.errors.length} ERROR(S), not safe to apply:`)
    for (const e of result.errors) console.error(` - ${e}`)
    process.exit(1)
  }
  if (!a.apply) {
    console.log('\nDry run only. Nothing was written.')
    return
  }
  const confirm = Number(a.confirm)
  if (!Number.isInteger(confirm) || confirm !== result.rows.length) {
    console.error(`Refusing to apply: --confirm must equal the row count (${result.rows.length}).`)
    process.exit(2)
  }
  await apply(result.rows)
}

async function apply(rows: ImportRow[]) {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set'); process.exit(2) }
  const pc: any = await import('@prisma/client')
  const { PrismaNeon } = await import('@prisma/adapter-neon')
  const PrismaClient = pc.PrismaClient ?? pc.default?.PrismaClient
  const prisma: any = new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) })
  try {
    const before = { imported: await prisma.proposal.count({ where: { source: 'IMPORTED' } }), app: await prisma.proposal.count({ where: { source: 'APP' } }), payments: await prisma.proposalPayment.count() }
    let created = 0
    let updated = 0
    for (const r of rows) {
      const existing = await prisma.proposal.findUnique({ where: { importKey: r.importKey }, select: { id: true, source: true } })
      if (existing && existing.source !== 'IMPORTED') throw new Error(`importKey ${r.importKey} collides with an app proposal; aborting`)
      const when = (s: string | null) => (s ? new Date(s) : null)
      const data = {
        kind: r.kind, status: r.status, title: r.title, body: r.body || r.title, amountUsdCents: r.amountUsdCents,
        eventDate: when(r.eventDate), city: r.city, proposerDiscordId: r.proposerDiscordId, proposerLabel: r.proposerLabel,
        opensAt: when(r.opensAt), closesAt: when(r.closesAt), closedAt: when(r.closedAt), ayesNeeded: r.ayesNeeded,
        countAbstains: r.countAbstains, requireAyesOverNays: r.requireAyesOverNays, ayes: r.ayes, nays: r.nays, abstains: r.abstains,
        votesRecorded: r.votesRecorded, outcomeSource: r.outcomeSource, paidOverride: r.paidOverride, historical: r.historical,
        // The cron must never post a result for history.
        resultPostedAt: when(r.closedAt) ?? new Date(),
      }
      await prisma.$transaction(async (tx: any) => {
        let id: string
        if (existing) {
          id = existing.id
          await tx.proposal.update({ where: { id }, data })
          updated++
        } else {
          const row = await tx.proposal.create({ data: { ...data, importKey: r.importKey, source: 'IMPORTED', createdAt: when(r.opensAt) ?? new Date() }, select: { id: true } })
          id = row.id
          await tx.proposalEvent.create({ data: { proposalId: id, type: 'IMPORTED', data: { importKey: r.importKey } } })
          created++
        }
        for (const l of r.links) {
          await tx.proposalLink.upsert({
            where: { proposalId_sourceKey: { proposalId: id, sourceKey: l.sourceKey } },
            create: { proposalId: id, kind: l.kind, url: l.url, label: l.label, sourceKey: l.sourceKey },
            update: { kind: l.kind, url: l.url, label: l.label },
          })
        }
        for (const p of r.payments) {
          const f = {
            paidAt: p.paidAt ? new Date(p.paidAt) : null, amount: p.amount, asset: p.asset, chain: p.chain, usdValue: p.usdCents,
            txHash: p.txHash, offchainRef: p.offchainRef, note: p.note, source: p.source,
          }
          await tx.proposalPayment.upsert({
            where: { proposalId_sourceKey: { proposalId: id, sourceKey: p.sourceKey } },
            create: { proposalId: id, sourceKey: p.sourceKey, ...f },
            update: f,
          })
        }
      })
    }
    const after = { imported: await prisma.proposal.count({ where: { source: 'IMPORTED' } }), app: await prisma.proposal.count({ where: { source: 'APP' } }), payments: await prisma.proposalPayment.count() }
    console.log(JSON.stringify({ created, updated, before, after }, null, 2))
    if (after.app !== before.app) throw new Error('app proposal count changed')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
