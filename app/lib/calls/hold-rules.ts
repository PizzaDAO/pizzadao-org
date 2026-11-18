/**
 * Pure hold rules (no session or database imports, so review cards and the recordings code can use them
 * without pulling in the auth guards). Re-exported from access.ts.
 */
import { containsWord, type PostFilter } from '@/app/lib/calls/post-filters'
import { normalizeCrewId } from '@/app/lib/crew-id'
import { segmentKey } from '@/app/lib/calls/chat'

export interface HoldView {
  source?: string | null
  status?: string | null
  eventName?: string | null
  crewLabel?: string | null
  transcript?: unknown
  redactedSpeakerIds?: readonly string[] | null
  redactedSegmentIds?: readonly string[] | null
  reviewHoldAt?: Date | null
  crewId?: string | null
  title?: string | null
  summary?: string | null
  actionItems?: unknown
  chapters?: unknown
}

export type HeldReason = 'manual' | 'crew' | 'term' | 'unreadable'

const asList = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : [])

/**
 * Pure: does the private owner-only filter hold this call? Checks the owner-only crew ids, then the
 * owner-only terms (whole word, case-insensitive) across the title, summary, action item text and owner,
 * and chapter titles. A filter that could not be read (null) holds the call: fail closed.
 */
export function autoHoldReason(rec: HoldView, filter: PostFilter | null): 'crew' | 'term' | 'unreadable' | null {
  if (!filter) return 'unreadable'
  const crew = normalizeCrewId(rec.crewId)
  if (crew && (filter.ownerOnlyCrewIds ?? []).some((x) => normalizeCrewId(x) === crew)) return 'crew'
  const terms = filter.ownerOnlyTerms ?? []
  if (terms.length === 0) return null
  const texts: string[] = [rec.title ?? '', rec.summary ?? '', rec.eventName ?? '', rec.crewLabel ?? '']
  // The visible transcript lines too (hidden speakers and lines are not public text, so they are not scanned).
  const hiddenSpeakers = new Set(rec.redactedSpeakerIds ?? [])
  const hiddenLines = new Set(rec.redactedSegmentIds ?? [])
  for (const seg of asList(rec.transcript)) {
    try {
      if (hiddenSpeakers.has(String(seg.discordId ?? '')) || hiddenLines.has(segmentKey(seg as never))) continue
    } catch {
      // an odd line: scan it anyway (fail closed)
    }
    texts.push(String(seg.text ?? ''))
  }
  for (const a of asList(rec.actionItems)) texts.push(String(a.text ?? ''), String(a.owner ?? ''))
  for (const c of asList(rec.chapters)) texts.push(String(c.title ?? ''))
  return texts.some((t) => !!t && terms.some((term) => containsWord(t, term))) ? 'term' : null
}

/** Why a call is held for the owner, or null. A manual hold wins over an automatic one. */
export function heldReason(rec: HoldView, filter: PostFilter | null): HeldReason | null {
  if (rec.reviewHoldAt) return 'manual'
  return autoHoldReason(rec, filter)
}

