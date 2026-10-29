/** What a viewer may see of someone's passport (plans/pizza-passport.md, D7). */

export type PassportVisibility = 'public' | 'members' | 'private'

export function parseVisibility(v: unknown): PassportVisibility {
  return v === 'members' || v === 'private' || v === 'public' ? v : 'public'
}

export type Viewer = 'owner' | 'member' | 'anonymous'

export function canView(visibility: PassportVisibility, viewer: Viewer): boolean {
  if (viewer === 'owner') return true
  if (visibility === 'private') return false
  if (visibility === 'members') return viewer === 'member'
  return true
}

/** Month-only date for other people's eyes: "2026-10". */
export function monthOnly(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Stamps other viewers may see: only those older than the delay. Owners see everything at once. */
export function visibleStamps<T extends { stampedAt: Date }>(
  rows: T[],
  viewer: Viewer,
  delayHours: number,
  now: Date = new Date(),
): T[] {
  if (viewer === 'owner') return rows
  const cutoff = now.getTime() - delayHours * 3_600_000
  return rows.filter((r) => r.stampedAt.getTime() <= cutoff)
}
