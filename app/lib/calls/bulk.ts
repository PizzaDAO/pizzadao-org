/**
 * Bulk review of imported calls that are IN_REVIEW: publish or reject many at once. Every id still goes through the normal
 * single-call gate (publishRecording: IN_REVIEW, a summary, visible text, the updatedAt guard), so a call
 * that is not ready is reported, never forced. Discord-recorded calls are refused here; they are reviewed
 * one by one. Bulk publish never posts a Discord recap.
 */
import { prisma } from '@/app/lib/db'
import { getSetting } from '@/app/lib/settings'
import { publishRecording, rejectRecording, type PublishResult } from './recordings'
import { isImportedSource } from './imported'

export const BULK_HARD_MAX = 50
export type BulkAction = 'publish' | 'reject'
export type BulkItemResult = PublishResult | 'rejected' | 'not-imported'

/** The per-click cap (setting calls.bulkActionMax, never above 50; 1 if the settings cannot be read). */
export async function bulkActionMax(): Promise<number> {
  try {
    const n = await getSetting('calls.bulkActionMax')
    return Math.min(Math.max(Math.trunc(n), 1), BULK_HARD_MAX)
  } catch {
    return 1
  }
}

export async function bulkReview(
  action: BulkAction,
  ids: string[],
  reviewerDiscordId: string,
): Promise<Array<{ id: string; result: BulkItemResult }>> {
  const unique = [...new Set(ids)]
  const rows = await prisma.callRecording.findMany({ where: { id: { in: unique } }, select: { id: true, source: true, status: true } })
  const imported = new Map(rows.map((r) => [r.id, isImportedSource(r.source)]))
  const inReview = new Map(rows.map((r) => [r.id, r.status === 'IN_REVIEW']))
  const out: Array<{ id: string; result: BulkItemResult }> = []
  // One at a time: each publish is a guarded write, and order keeps the report readable.
  for (const id of unique) {
    if (!imported.has(id)) out.push({ id, result: 'not-found' })
    else if (!imported.get(id)) out.push({ id, result: 'not-imported' })
    // Bulk actions are for calls waiting in review; published or rejected calls are handled one by one.
    else if (!inReview.get(id)) out.push({ id, result: 'not-allowed' })
    else if (action === 'publish') out.push({ id, result: await publishRecording(id, reviewerDiscordId).catch(() => 'conflict' as const) })
    else out.push({ id, result: (await rejectRecording(id, reviewerDiscordId).catch(() => false)) ? 'rejected' : 'not-found' })
  }
  return out
}
