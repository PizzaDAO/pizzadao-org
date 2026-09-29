// app/lib/display-name.ts
//
// Display-name ("mafia name") normalisation, shared by the server
// (app/lib/profile/validation.ts, /api/profile) and the onboarding wizard
// (NameStep) so what the member sees before submitting is exactly what gets
// stored. Pure + dependency-free so it is safe to import on the client.
//
// Rules (member request):
//   1. Unicode NFKC (folds full-width / stylised "𝓕𝓪𝓷𝓬𝔂" letters to plain ones)
//   2. Typographic apostrophes/dashes → ASCII ' and -
//   3. Strip control characters and invisible format characters
//      (zero-width spaces/joiners, BOM, bidi overrides, soft hyphen, …)
//   4. Keep only letters, combining marks (max 2 per char), numbers,
//      spaces and ' - . &
//   5. Collapse whitespace, trim, cap at 64 characters (code points)
//   6. A result with no letter or number is treated as empty (rejected)

export const DISPLAY_NAME_MAX_LENGTH = 64;

const APOSTROPHES = /[\u2018\u2019\u201B\u02BC\u02BB`\u00B4\u2032]/g;
const DASHES = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g;
// Whitespace-like controls become spaces so words don't get glued together.
// (Explicit list rather than \s, which would also match the BOM U+FEFF.)
const WHITESPACE = /[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/g;
// Cc = control, Cf = format (ZWSP U+200B, ZWNJ/ZWJ, LRM/RLM, bidi
// embeddings/overrides/isolates, word joiner, BOM, soft hyphen, …),
// plus Hangul/Braille "blank" letters abused as invisible names.
const INVISIBLE = /[\p{Cc}\p{Cf}\u115F\u1160\u3164\uFFA0\u2800]/gu;
const DISALLOWED = /[^\p{L}\p{M}\p{N} '\-.&]/gu;
const HAS_ALNUM = /[\p{L}\p{N}]/u;

/**
 * Normalise a user-supplied display name. Returns "" when nothing usable
 * remains — callers must treat "" as invalid.
 */
export function sanitizeDisplayName(input: unknown): string {
  if (input === null || input === undefined) return "";
  let s = String(input);

  s = s.normalize("NFKC");
  s = s.replace(APOSTROPHES, "'").replace(DASHES, "-");
  s = s.replace(WHITESPACE, " ");
  s = s.replace(INVISIBLE, "");
  s = s.replace(DISALLOWED, "");
  // Tame "Zalgo" stacks: at most two combining marks per base character.
  s = s.replace(/(\p{M}{2})\p{M}+/gu, "$1");
  s = s.replace(/ {2,}/g, " ").trim();

  // Cap by code point so we never split a surrogate pair.
  const chars = Array.from(s);
  if (chars.length > DISPLAY_NAME_MAX_LENGTH) {
    s = chars.slice(0, DISPLAY_NAME_MAX_LENGTH).join("").trim();
  }

  return HAS_ALNUM.test(s) ? s : "";
}

/** Convenience wrapper for form validation. */
export function validateDisplayName(
  input: unknown
): { ok: true; name: string } | { ok: false; error: string } {
  const name = sanitizeDisplayName(input);
  if (!name) {
    return { ok: false, error: "Name must contain at least one letter or number." };
  }
  return { ok: true, name };
}
