/**
 * Pure planning for sheet imports: compare what the sheet holds with what the database holds, by a
 * stable natural key, and say what an apply would do. Never deletes: database rows missing from the
 * sheet are reported as orphans.
 */

export interface UpsertPlan<T> {
  create: Array<{ key: string; value: T }>
  update: Array<{ key: string; value: T; previous: T }>
  unchanged: number
  /** Keys in the database that the sheet no longer has (left alone). */
  orphans: string[]
}

/** JSON with object keys sorted, so equal values compare equal whatever their key order. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      return Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
    }
    return v
  })
}

export function stableEqual(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b)
}

export function planUpserts<T>(
  incoming: ReadonlyArray<{ key: string; value: T }>,
  existing: ReadonlyMap<string, T>,
  equal: (a: T, b: T) => boolean = stableEqual,
): UpsertPlan<T> {
  const plan: UpsertPlan<T> = { create: [], update: [], unchanged: 0, orphans: [] }
  const seen = new Set<string>()
  for (const rec of incoming) {
    if (seen.has(rec.key)) continue // the loader de-duplicates; this is a guard
    seen.add(rec.key)
    const prev = existing.get(rec.key)
    if (prev === undefined) plan.create.push(rec)
    else if (equal(prev, rec.value)) plan.unchanged++
    else plan.update.push({ key: rec.key, value: rec.value, previous: prev })
  }
  for (const key of existing.keys()) if (!seen.has(key)) plan.orphans.push(key)
  return plan
}

/** Lowercase, collapse whitespace, strip punctuation at the ends: for matching labels across re-imports. */
export function normalizeLabel(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '').trim()
}

/**
 * Natural keys for rows that have no id of their own (tasks, goals, agenda steps): the normalized
 * label, with `#2`, `#3`... for repeats in the same scope. Re-ordering rows in the sheet keeps
 * every key, so a re-import does not duplicate them.
 */
export function labelKeys(scope: string, labels: readonly string[]): string[] {
  const counts = new Map<string, number>()
  return labels.map((label) => {
    const base = `${scope}:${normalizeLabel(label)}`
    const n = (counts.get(base) ?? 0) + 1
    counts.set(base, n)
    return n === 1 ? base : `${base}#${n}`
  })
}
