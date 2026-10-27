/**
 * Crews that must never appear in automated Discord posts (pre-call agendas, post-call recaps).
 *
 * Default: the PizzaDAO APAC crew. It is matched robustly rather than by one hard-coded id: a crew
 * is excluded when its id (crew-mappings slug) has an "apac" segment, or its label contains the
 * word APAC, case-insensitively ("PizzaDAO APAC", "pizzadao_apac", "APAC-Crew"; not "capacity").
 *
 * Override: env CALL_POST_EXCLUDED_CREWS, comma-separated crew ids. When set (non-empty) it REPLACES
 * the default list entirely (so include the APAC id in it if it should stay excluded); ids are
 * compared after the same slug normalization as crew-mappings. Unset/blank keeps the default.
 */
import { normalizeCrewId } from '@/app/lib/crew-id'

type Env = Record<string, string | undefined>

/** The word APAC, not part of a longer word (so "capacity" does not match; "pizzadao_apac" does). */
const APAC_WORD = /(^|[^a-z])apac([^a-z]|$)/i

/** Does free text (a summary sentence, action item, label) mention APAC? */
export function mentionsApac(text: string | null | undefined): boolean {
  return APAC_WORD.test(text ?? '')
}

/** Explicit override list from CALL_POST_EXCLUDED_CREWS, or null when unset/blank. */
export function excludedCrewOverride(env: Env = process.env): Set<string> | null {
  const raw = env.CALL_POST_EXCLUDED_CREWS?.trim()
  if (!raw) return null
  return new Set(raw.split(',').map((s) => normalizeCrewId(s)).filter(Boolean))
}

export function isCrewExcluded(crew: { id?: string | null; label?: string | null }, env: Env = process.env): boolean {
  const override = excludedCrewOverride(env)
  if (override) return override.has(normalizeCrewId(crew.id))
  // The id is the crew-mappings slug; an "apac" segment (or the word in the label) identifies the APAC crew.
  const id = normalizeCrewId(crew.id)
  if (id && id.split('_').includes('apac')) return true
  return mentionsApac(crew.label)
}
