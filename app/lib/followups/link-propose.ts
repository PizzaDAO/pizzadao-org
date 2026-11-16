/**
 * Proposes which stored action item an existing (unlinked) follow-up is about, for calls drafted
 * before follow-ups carried an action key (scripts/calls/link-followups-to-actions.ts). Pure: no
 * database. Conservative on purpose: a follow-up is linked only when one item clearly wins (owner
 * match and/or similar wording); anything doubtful stays unlinked and a reviewer links it by hand.
 */
import { textSimilarity } from '@/app/lib/calls/action-keys'
import { normalizeName } from './resolve'

export interface ProposeItem {
  index: number
  text: string
  owner?: string | null
}
export interface ProposeFollowUp {
  id: string
  ownerName: string
  ask: string
}
export interface LinkProposal {
  followUpId: string
  /** Position of the item in the stored list (keys may not exist yet). */
  itemIndex: number
  score: number
}

const MIN_SCORE = 0.3
const MIN_MARGIN = 0.1
const OWNER_BONUS = 0.3

/** Same person by name: equal, or all words of the shorter name are in the longer, or the same first name word. */
export function sameOwnerName(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizeName(a ?? '')
  const y = normalizeName(b ?? '')
  if (!x || !y) return false
  const xs = x.split(' ')
  const ys = y.split(' ')
  const [small, big] = xs.length <= ys.length ? [xs, ys] : [ys, xs]
  if (x === y || small.every((w) => big.includes(w))) return true
  return xs[0] === ys[0] && xs[0].length >= 3
}

export function proposeLinks(items: readonly ProposeItem[], followUps: readonly ProposeFollowUp[]): LinkProposal[] {
  const out: LinkProposal[] = []
  for (const f of followUps) {
    const scored = items
      .map((it) => {
        const sim = textSimilarity(f.ask, it.text)
        const owner = sameOwnerName(f.ownerName, it.owner)
        // Without an owner match the wording alone must be a clear match.
        return { itemIndex: it.index, score: owner ? sim + OWNER_BONUS : sim >= 0.5 ? sim : 0 }
      })
      .filter((s) => s.score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score)
    if (scored.length === 0) continue
    if (scored.length > 1 && scored[0].score - scored[1].score < MIN_MARGIN) continue
    out.push({ followUpId: f.id, itemIndex: scored[0].itemIndex, score: Math.round(scored[0].score * 100) / 100 })
  }
  return out
}

/** The earliest date a backfill may reach: the live-status feature did not exist before. */
export const BACKFILL_EARLIEST = '2026-11-01'

/** Parses --since (YYYY-MM-DD), defaulting to and never earlier than BACKFILL_EARLIEST. Returns null for anything malformed. */
export function parseSince(raw: string | undefined): Date | null {
  const v = raw ?? BACKFILL_EARLIEST
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v < BACKFILL_EARLIEST) return null
  const d = new Date(`${v}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d
}
