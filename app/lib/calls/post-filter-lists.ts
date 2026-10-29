/**
 * Pure list cleaning for the call post filter (no database import, so the settings registry can use it).
 * Limits: at most MAX_FILTER_ENTRIES entries per list, each at most MAX_FILTER_ENTRY_CHARS long.
 */

export const MAX_FILTER_ENTRIES = 200
export const MAX_FILTER_ENTRY_CHARS = 100

/** Trim, drop blanks, de-duplicate (case-insensitive), clamp length and count. */
export function cleanList(list: unknown): string[] {
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    if (typeof raw !== 'string') continue
    const v = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_FILTER_ENTRY_CHARS)
    const k = v.toLowerCase()
    if (!v || seen.has(k)) continue
    seen.add(k)
    out.push(v)
    if (out.length >= MAX_FILTER_ENTRIES) break
  }
  return out
}
