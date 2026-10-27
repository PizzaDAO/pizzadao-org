/**
 * Private editorial filters for Metalhead's automated call posts (pre-call agendas, post-call
 * recaps). The values live in the database (CallPostFilter, one row), edited by call reviewers on
 * /admin/calls; nothing about them is in code, config or any public surface.
 *
 * - excludedCrewIds: crews that never get an automated post (compared as crew-mappings slugs).
 * - excludedCrewLabelTerms: whole-word terms; a crew whose label (or id) contains one is excluded.
 * - blockedTerms: whole-word terms; agenda items and recap bullets / action items that contain one
 *   are dropped from the Discord text only (stored data is untouched).
 *
 * Fail-safe: loadPostFilter() THROWS when the database cannot be read; callers must then skip
 * posting rather than post unfiltered.
 */
import { prisma } from '@/app/lib/db'
import { normalizeCrewId } from '@/app/lib/crew-id'

export interface PostFilter {
  excludedCrewIds: string[]
  excludedCrewLabelTerms: string[]
  blockedTerms: string[]
}

export const EMPTY_POST_FILTER: PostFilter = { excludedCrewIds: [], excludedCrewLabelTerms: [], blockedTerms: [] }

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

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whole-word, case-insensitive: the term must not touch another letter or digit on either side. */
function containsWord(text: string, term: string): boolean {
  const t = term.trim()
  if (!t) return false
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(t)}($|[^\\p{L}\\p{N}])`, 'iu').test(text)
}

/** Does free text (a summary sentence, action item, owner, label) contain a blocked term? */
export function mentionsBlockedTerm(text: string | null | undefined, filter: PostFilter): boolean {
  const s = text ?? ''
  return !!s && filter.blockedTerms.some((term) => containsWord(s, term))
}

/** Is this crew excluded from automated posts? */
export function isCrewExcluded(crew: { id?: string | null; label?: string | null }, filter: PostFilter): boolean {
  const id = normalizeCrewId(crew.id)
  if (id && filter.excludedCrewIds.some((x) => normalizeCrewId(x) === id)) return true
  const label = crew.label ?? ''
  // Slug segments count as words too ("some_term_crew").
  const idText = id.replace(/_/g, ' ')
  return filter.excludedCrewLabelTerms.some((term) => containsWord(label, term) || containsWord(idText, term))
}

const CACHE_MS = 30_000
let cached: { at: number; filter: PostFilter } | null = null

/** Test hook / after saving: forget the cached filter. */
export function clearPostFilterCache(): void {
  cached = null
}

/** The current filter (cached ~30s). Throws if the database read fails. */
export async function loadPostFilter(now: number = Date.now()): Promise<PostFilter> {
  if (cached && now - cached.at < CACHE_MS) return cached.filter
  const row = await prisma.callPostFilter.findUnique({ where: { id: 1 } })
  const filter: PostFilter = row
    ? { excludedCrewIds: cleanList(row.excludedCrewIds), excludedCrewLabelTerms: cleanList(row.excludedCrewLabelTerms), blockedTerms: cleanList(row.blockedTerms) }
    : EMPTY_POST_FILTER
  cached = { at: now, filter }
  return filter
}

/** Replace the three lists. Returns what was stored. */
export async function savePostFilter(input: Partial<PostFilter>, updatedBy: string): Promise<PostFilter> {
  const data: PostFilter = {
    excludedCrewIds: cleanList(input.excludedCrewIds),
    excludedCrewLabelTerms: cleanList(input.excludedCrewLabelTerms),
    blockedTerms: cleanList(input.blockedTerms),
  }
  await prisma.callPostFilter.upsert({
    where: { id: 1 },
    create: { id: 1, ...data, updatedBy },
    update: { ...data, updatedBy },
  })
  clearPostFilterCache()
  return data
}
