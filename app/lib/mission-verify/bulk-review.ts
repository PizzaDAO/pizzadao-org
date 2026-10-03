/**
 * Bulk approve for the web review panel (plans/mission-verification.md §5.3,
 * Phase 4): a reviewer ticks several pending submissions (typically the
 * semi-automatic ones whose pre-checks are all green) and approves them in
 * one click.
 *
 * Every item goes through exactly the same gate and write as a single
 * approve (POST /api/missions/review):
 *   - canReviewMission for the item's level (L8 = Dread Pizza Roberts only),
 *   - never your own submission,
 *   - a manual "Invite a friend" needs a note (approvalNeedsNote),
 *   - approveMission: the conditional PENDING -> APPROVED update, the one
 *     MissionReviewEvent, settleLevels() (race-safe, each level paid once).
 * So a bulk approve racing a single approve, a Discord click or the
 * verifier resolves exactly like two single approves: one wins, the other is
 * "already handled", and the member is paid once. Items are processed one
 * after the other and an item's failure never stops the rest.
 */
import { ConflictError, NotFoundError } from '../errors/api-errors'

export const BULK_APPROVE_MAX = 50

export interface BulkTarget {
  discordId: string
  level: number
  status: string
  noteRequired?: boolean
}

export interface BulkApproveDeps {
  target: (completionId: number) => Promise<BulkTarget | null>
  canReview: (reviewerId: string, level: number) => Promise<boolean>
  approve: (reviewerId: string, completionId: number, note?: string) => Promise<{ discordId: string; levelsPaid?: number[] }>
}

export type BulkOutcome = 'approved' | 'already_handled' | 'forbidden' | 'own_submission' | 'not_found' | 'note_required' | 'error'

export interface BulkItemResult {
  id: number
  outcome: BulkOutcome
  discordId?: string
  levelsPaid?: number[]
  error?: string
}

/** Parse the request's ids: positive integers, de-duplicated, at most BULK_APPROVE_MAX. null = invalid. */
export function parseBulkIds(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > BULK_APPROVE_MAX) return null
  if (!raw.every((x) => typeof x === 'number' && Number.isInteger(x) && x > 0)) return null
  return [...new Set(raw as number[])]
}

export async function bulkApprove(reviewerId: string, ids: number[], opts: { note?: string }, deps: BulkApproveDeps): Promise<BulkItemResult[]> {
  const note = opts.note?.trim() || undefined
  const levelOk = new Map<number, boolean>()
  const out: BulkItemResult[] = []
  for (const id of ids) {
    try {
      const t = await deps.target(id)
      if (!t) {
        out.push({ id, outcome: 'not_found' })
        continue
      }
      if (!levelOk.has(t.level)) levelOk.set(t.level, await deps.canReview(reviewerId, t.level))
      if (!levelOk.get(t.level)) {
        out.push({ id, outcome: 'forbidden' })
        continue
      }
      if (t.discordId === reviewerId) {
        out.push({ id, outcome: 'own_submission' })
        continue
      }
      if (t.status !== 'PENDING') {
        out.push({ id, outcome: 'already_handled' })
        continue
      }
      if (t.noteRequired && !(note && note.length >= 3)) {
        out.push({ id, outcome: 'note_required' })
        continue
      }
      const r = await deps.approve(reviewerId, id, note)
      out.push({ id, outcome: 'approved', discordId: r.discordId, levelsPaid: r.levelsPaid ?? [] })
    } catch (e) {
      if (e instanceof ConflictError) out.push({ id, outcome: 'already_handled' })
      else if (e instanceof NotFoundError) out.push({ id, outcome: 'not_found' })
      else {
        console.error(`[missions] bulk approve of completion ${id} failed:`, e)
        out.push({ id, outcome: 'error', error: 'Approval failed' })
      }
    }
  }
  return out
}
