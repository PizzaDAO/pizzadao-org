/**
 * Deepgram Nova-3 keyterm prompting: terms (conference names, community lingo) the transcriber
 * should spell correctly. Deepgram caps the whole request at 500 tokens; the limits here stay
 * safely under that (names tokenize at roughly 3 characters per token). Keep in sync with
 * app/lib/calls/keyterms.ts.
 */
export const MAX_KEYTERMS = 100
export const MAX_KEYTERM_CHARS = 40
/** Conservative token budget for the whole list; Deepgram's own limit is 500 tokens per request. */
export const MAX_KEYTERM_TOKENS = 300

/** Deliberately high estimate: each non-ASCII character 1 token, ASCII characters / 3 rounded up, plus 1 per term. */
export function estimateKeytermTokens(term: string): number {
  let ascii = 0
  let other = 0
  for (const ch of term) {
    if (ch.charCodeAt(0) < 128) ascii++
    else other++
  }
  return other + Math.ceil(ascii / 3) + 1
}

/** Trim, drop blanks, control characters, over-long terms and duplicates (any case); skip what exceeds the limits. */
export function normalizeKeyterms(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  let tokens = 0
  for (const v of raw) {
    if (typeof v !== 'string') continue
    const t = v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()
    if (!t || t.length > MAX_KEYTERM_CHARS || seen.has(t.toLowerCase())) continue
    if (out.length >= MAX_KEYTERMS || tokens + estimateKeytermTokens(t) > MAX_KEYTERM_TOKENS) continue
    seen.add(t.toLowerCase())
    out.push(t)
    tokens += estimateKeytermTokens(t)
  }
  return out
}
