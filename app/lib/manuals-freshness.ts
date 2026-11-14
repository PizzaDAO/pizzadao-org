/**
 * Review markers for the manuals index (plans/training-manual-on-site.md, phase 2). Pure: the API
 * decorates each manual, the page only renders and filters.
 */
export interface ManualMarkers {
  /** ISO date (YYYY-MM-DD) the manual was last reviewed, or null. */
  reviewedAt: string | null
  /** An in-app path that replaces the manual, or null. */
  supersededBy: string | null
}

export interface ManualFreshness extends ManualMarkers {
  /** Reviewed, but longer ago than the threshold. */
  stale: boolean
  /** No reviewed date at all. */
  neverReviewed: boolean
  draft: boolean
  replaced: boolean
  /** Left off the list by the hide settings. */
  hidden: boolean
}

export interface FreshnessOptions {
  now: Date
  staleAfterDays: number
  hideDrafts: boolean
  hideReplaced: boolean
}

const DAY_MS = 86_400_000

/** An internal path only ("/handbook/x"): never an external or protocol-relative address. */
export function isInternalPath(v: string): boolean {
  return /^\/(?!\/)[A-Za-z0-9\-._~/%#?=&]*$/.test(v) && !v.includes('..')
}

/** YYYY-MM-DD (or a full ISO timestamp) -> a Date, or null when it is not a real date. */
export function parseReviewedDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(t)) return null
  const d = new Date(t.length === 10 ? `${t}T00:00:00.000Z` : t)
  if (Number.isNaN(d.getTime())) return null
  // Reject roll-overs such as 2026-02-31.
  if (t.length === 10 && d.toISOString().slice(0, 10) !== t) return null
  return d
}

export function isDraftStatus(status: string): boolean {
  return status.trim().toLowerCase() === 'draft'
}

export function isStale(reviewedAt: Date | null, now: Date, staleAfterDays: number): boolean {
  if (!reviewedAt) return false
  return now.getTime() - reviewedAt.getTime() > staleAfterDays * DAY_MS
}

export function manualFreshness(
  m: { status: string; reviewedAt?: Date | string | null; supersededBy?: string | null },
  o: FreshnessOptions,
): ManualFreshness {
  const reviewed = parseReviewedDate(m.reviewedAt ?? null)
  const supersededBy = m.supersededBy && isInternalPath(m.supersededBy) ? m.supersededBy : null
  const draft = isDraftStatus(m.status)
  const replaced = supersededBy !== null
  return {
    reviewedAt: reviewed ? reviewed.toISOString().slice(0, 10) : null,
    supersededBy,
    stale: isStale(reviewed, o.now, o.staleAfterDays),
    neverReviewed: reviewed === null,
    draft,
    replaced,
    hidden: (o.hideDrafts && draft) || (o.hideReplaced && replaced),
  }
}

/** Display order: replaced manuals last, otherwise the index order. Returns indexes into the input. */
export function displayOrder(items: ReadonlyArray<{ replaced?: boolean }>): number[] {
  const idx = items.map((_, i) => i)
  return [...idx.filter((i) => !items[i].replaced), ...idx.filter((i) => items[i].replaced)]
}
