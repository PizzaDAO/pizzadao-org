/**
 * Private editorial filters for Metalhead's automated call posts (pre-call agendas, post-call
 * recaps). The values live in the database as the private setting `calls.postFilter` (edited by call
 * reviewers on /admin/calls); nothing about them is in code, config or any public surface. Until that
 * setting has no saved row, its default (no filter) applies.
 *
 * - excludedCrewIds: crews that never get an automated post (compared as crew-mappings slugs).
 * - excludedCrewLabelTerms: whole-word terms; a crew whose label (or id) contains one is excluded.
 * - blockedTerms: whole-word terms; agenda items and recap bullets / action items that contain one
 *   are dropped from the Discord text only (stored data is untouched).
 *
 * Fail-safe: loadPostFilter() THROWS when the setting cannot be read (database down, or a
 * stored value that fails validation); callers must then skip posting rather than post unfiltered.
 */
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

/** Test hook / after saving: forget the cached settings snapshot the filter came from. */
export function clearPostFilterCache(): void {
  clearSettingsCache()
}

const clean = (v: Partial<PostFilter> | null | undefined): PostFilter => ({
  excludedCrewIds: cleanList(v?.excludedCrewIds),
  excludedCrewLabelTerms: cleanList(v?.excludedCrewLabelTerms),
  blockedTerms: cleanList(v?.blockedTerms),
})

/**
 * The current filter (settings cached ~30s). With no saved row the setting's empty default applies.
 * Throws if the settings cannot be read or the saved value is invalid; callers then skip posting.
 */
export async function loadPostFilter(now: number = Date.now()): Promise<PostFilter> {
  const settings = await loadSettings(now)
  if (settings.readFailed || settings.invalidKeys.includes(KEY)) throw new Error('Post filter could not be read')
  return clean(settings.get(KEY))
}

/** Replace the three lists (saved as the private setting, audited with the values masked). */
export async function savePostFilter(input: Partial<PostFilter>, updatedBy: string): Promise<PostFilter> {
  const data = clean(input)
  await saveSetting(KEY, data, updatedBy)
  clearPostFilterCache()
  return data
}
