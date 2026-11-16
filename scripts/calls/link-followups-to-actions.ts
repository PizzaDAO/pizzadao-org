/**
 * Link existing follow-ups to the action items they are about, for recent calls drafted before
 * follow-ups carried an action key (plans/recap-action-status.md). It also gives those calls' action
 * items their keys.
 *
 *   node scripts/calls/link-followups-to-actions.ts [--since 2026-11-01]
 *       dry run (default): prints what it would do, writes nothing.
 *   ... --apply
 *       recomputes the same plan, prints it, then writes exactly that: action keys for the calls in the
 *       plan and `actionKey` on the follow-ups in it (only rows that still have none).
 *
 * --since is a date (YYYY-MM-DD) and cannot be earlier than 2026-11-01. Only PUBLISHED / IN_REVIEW calls
 * that started on or after it, with follow-ups that have no link yet, are looked at. Matching is
 * conservative (owner name + wording, one clear winner); the rest stays unlinked for a reviewer.
 * Output has call and follow-up ids and scores only, no names or text. It does not edit any posted
 * recap: after linking, use "Update recap" on a call (or let the next status change do it).
 *
 * Needs DATABASE_URL. Bulk writes to production only with the owner's explicit OK. Run with Node 24.
 */
import { register } from 'node:module'

register('../members/alias-hooks.mjs', import.meta.url)

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const apply = process.argv.includes('--apply')
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is not set'); process.exit(2) }
  const { parseSince, proposeLinks, BACKFILL_EARLIEST } = await import('../../app/lib/followups/link-propose.ts')
  const since = parseSince(arg('--since'))
  if (!since) { console.error(`--since must be a date (YYYY-MM-DD) on or after ${BACKFILL_EARLIEST}`); process.exit(2) }
  const { prisma } = await import('../../app/lib/db.ts')
  const { ensureActionKeys } = await import('../../app/lib/calls/action-keys.ts')
  try {
    const ids = (await prisma.followUp.findMany({ where: { actionKey: null, recordingId: { not: null } }, select: { recordingId: true }, distinct: ['recordingId'] })).map((r) => r.recordingId as string)
    const recs = await prisma.callRecording.findMany({
      where: { id: { in: ids }, startedAt: { gte: since }, status: { in: ['PUBLISHED', 'IN_REVIEW'] } },
      select: { id: true, actionItems: true },
      orderBy: { startedAt: 'asc' },
    })

    const plan: Array<{ recordingId: string; links: Array<{ followUpId: string; itemIndex: number; score: number }>; unlinked: number }> = []
    for (const rec of recs) {
      // Positions count object entries only, the same list ensureActionKeys returns keys for.
      const objects = (Array.isArray(rec.actionItems) ? rec.actionItems : []).filter((x) => !!x && typeof x === 'object' && !Array.isArray(x))
      const items = objects.flatMap((a, index) => {
        const o = a as { text?: unknown; owner?: unknown }
        return typeof o.text === 'string' && o.text ? [{ index, text: o.text, owner: typeof o.owner === 'string' ? o.owner : null }] : []
      })
      const followUps = await prisma.followUp.findMany({ where: { recordingId: rec.id, actionKey: null }, select: { id: true, ownerName: true, ask: true } })
      const links = proposeLinks(items, followUps)
      plan.push({ recordingId: rec.id, links, unlinked: followUps.length - links.length })
    }
    const total = plan.reduce((n, p) => n + p.links.length, 0)
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', since: since.toISOString().slice(0, 10), calls: plan.length, links: total, unlinked: plan.reduce((n, p) => n + p.unlinked, 0) }, null, 2))
    for (const p of plan) for (const l of p.links) console.log(`${p.recordingId} item#${l.itemIndex} <- follow-up ${l.followUpId} (score ${l.score})`)
    if (!apply) { console.log('Dry run: nothing written. Re-run with --apply to write exactly this.'); return }

    let written = 0
    for (const p of plan.filter((x) => x.links.length > 0)) {
      // Keys are assigned (or read) per call under a lock; item order is the stored order.
      const keys = await ensureActionKeys(p.recordingId)
      for (const l of p.links) {
        const key = keys[l.itemIndex]?.key
        if (!key) continue
        const res = await prisma.followUp.updateMany({ where: { id: l.followUpId, actionKey: null }, data: { actionKey: key } })
        written += res.count
      }
    }
    console.log(JSON.stringify({ written }, null, 2))
  } finally {
    await (prisma as { $disconnect?: () => Promise<void> }).$disconnect?.()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
