/**
 * Deepgram Nova-3 keyterm prompting: terms (conference names, community lingo) the transcriber
 * should spell correctly. Deepgram caps the whole request at 500 tokens; the limits here stay
 * safely under that (names tokenize at roughly 3 characters per token). Keep in sync with
 * recorder/src/keyterms.ts (the recorder is a separate package).
 */
export const MAX_KEYTERMS = 100
export const MAX_KEYTERM_CHARS = 40
export const MAX_KEYTERMS_TOTAL_CHARS = 1000

/** Trim, drop blanks, control characters, over-long terms and duplicates (any case); stop at the limits. */
export function normalizeKeyterms(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  let total = 0
  for (const v of raw) {
    if (typeof v !== 'string') continue
    const t = v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()
    if (!t || t.length > MAX_KEYTERM_CHARS || seen.has(t.toLowerCase())) continue
    if (out.length >= MAX_KEYTERMS || total + t.length > MAX_KEYTERMS_TOTAL_CHARS) break
    seen.add(t.toLowerCase())
    out.push(t)
    total += t.length
  }
  return out
}
