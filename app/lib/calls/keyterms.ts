/**
 * Deepgram Nova-3 keyterm prompting: terms (conference names, community lingo) the transcriber
 * should spell correctly. Deepgram caps the whole request at 500 tokens; the limits here stay
 * safely under that (names tokenize at roughly 3 characters per token). Keep in sync with
 * recorder/src/keyterms.ts (the recorder is a separate package).
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

/** Whisper's prompt field holds about 224 tokens; stay far below it (same conservative estimate as above). */
export const MAX_WHISPER_PROMPT_TOKENS = 120

/**
 * The Whisper `prompt` that biases spelling toward the given terms, or undefined with none.
 * Terms only, kept short: Whisper can echo prompt text back on silent or near-silent audio, so
 * a long or sentence-like prompt would leak into transcripts (the existing low-confidence and
 * repeat filters still apply to the result).
 */
export function whisperPrompt(terms: readonly string[]): string | undefined {
  const out: string[] = []
  let tokens = 0
  for (const t of normalizeKeyterms([...terms])) {
    const n = estimateKeytermTokens(t)
    if (tokens + n > MAX_WHISPER_PROMPT_TOKENS) continue
    out.push(t)
    tokens += n
  }
  return out.length ? `Terms: ${out.join(', ')}.` : undefined
}
