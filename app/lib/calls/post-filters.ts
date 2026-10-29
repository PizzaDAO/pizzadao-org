/**
 * Private editorial filters for Metalhead's automated call posts (pre-call agendas, post-call
 * recaps). The values live in the database as the private setting `calls.postFilter` (edited by call
 * reviewers on /admin/calls); nothing about them is in code, config or any public surface. Until that
 * setting has a row, the older CallPostFilter table (one row) is read instead, so deploying before the
 * copy script runs (scripts/settings/migrate-call-post-filters.mjs) changes nothing.
 *
 * - excludedCrewIds: crews that never get an automated post (compared as crew-mappings slugs).
 * - excludedCrewLabelTerms: whole-word terms; a crew whose label (or id) contains one is excluded.
 * - blockedTerms: whole-word terms; agenda items and recap bullets / action items that contain one
 *   are dropped from the Discord text only (stored data is untouched).
 *
 * Fail-safe: loadPostFilter() THROWS when the setting or the table cannot be read (database down, or a
 * stored value that fails validation); callers must then skip posting rather than post unfiltered.
 */
import { prisma } from '@/app/lib/db'
import { clearSettingsCache, loadSettings } from '@/app/lib/settings'
import { saveSetting } from '@/app/lib/settings/store'
import { normalizeCrewId } from '@/app/lib/crew-id'

export interface PostFilter {
  excludedCrewIds: string[]
  excludedCrewLabelTerms: string[]
  blockedTerms: string[]
}

export const EMPTY_POST_FILTER: PostFilter = { excludedCrewIds: [], excludedCrewLabelTerms: [], blockedTerms: [] }

import { cleanList } from '@/app/lib/calls/post-filter-lists'

export { cleanList, MAX_FILTER_ENTRIES, MAX_FILTER_ENTRY_CHARS } from '@/app/lib/calls/post-filter-lists'

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

const KEY = 'calls.postFilter' as const
const CACHE_MS = 30_000
let cached: { at: number; filter: PostFilter } | null = null

/** Test hook / after saving: forget the cached filter (and the settings snapshot it came from). */
export function clearPostFilterCache(): void {
  cached = null
  clearSettingsCache()
}

const clean = (v: Partial<PostFilter> | null | undefined): PostFilter => ({
  excludedCrewIds: cleanList(v?.excludedCrewIds),
  excludedCrewLabelTerms: cleanList(v?.excludedCrewLabelTerms),
  blockedTerms: cleanList(v?.blockedTerms),
})

/**
 * The current filter (settings cached ~30s). A saved `calls.postFilter` wins; with none, the legacy
 * CallPostFilter row (cached ~30s) is used. Throws if either cannot be read or the saved value is invalid.
 */
export async function loadPostFilter(now: number = Date.now()): Promise<PostFilter> {
  const settings = await loadSettings(now)
  if (settings.readFailed || settings.invalidKeys.includes(KEY)) throw new Error('Post filter could not be read')
  if (settings.isSet(KEY)) return clean(settings.get(KEY))
  if (cached && now - cached.at < CACHE_MS) return cached.filter
  const row = await prisma.callPostFilter.findUnique({ where: { id: 1 } })
  const filter: PostFilter = row ? clean(row) : EMPTY_POST_FILTER
  cached = { at: now, filter }
  return filter
}

/**
 * Replace the three lists (saved as the private setting, audited with the values masked). The legacy
 * table is updated too, best effort, so rolling the code back does not bring back an older filter.
 */
export async function savePostFilter(input: Partial<PostFilter>, updatedBy: string): Promise<PostFilter & { mirrored: boolean }> {
  const data = clean(input)
  await saveSetting(KEY, data, updatedBy)
  let mirrored = true
  try {
    await prisma.callPostFilter.upsert({ where: { id: 1 }, create: { id: 1, ...data, updatedBy }, update: { ...data, updatedBy } })
  } catch (e) {
    mirrored = false
    console.error('[calls/post-filters] could not mirror the filter to the legacy table:', e instanceof Error ? e.message : e)
  }
  clearPostFilterCache()
  return { ...data, mirrored }
}
