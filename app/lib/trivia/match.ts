// app/lib/trivia/match.ts
//
// Pure answer matcher (plans/trivia.md §5). No I/O, never throws.
//
//   match(question, raw) -> { verdict: 'correct' | 'wrong' | 'ignore' }
//
// `ignore` = not an answer attempt (chit-chat, too long, no number in a number question...), so it must not
// use up an attempt. Numbers are never matched fuzzily (9,800 is not 9,900); text is, scaled to its length.
import type { TriviaQuestion } from "./schema";

export type Verdict = "correct" | "wrong" | "ignore";
export interface MatchResult {
  verdict: Verdict;
}

type MatchableQuestion = Pick<TriviaQuestion, "answer" | "aliases" | "rejects" | "match" | "choices">;

/** Longer than this (or more tokens than MAX_TOKENS) is chat, not an answer: it also stops answer-dumping. */
export const MAX_ANSWER_CHARS = 80;
export const MAX_TOKENS = 8;

// ---------------------------------------------------------------------------------------------------------------
// Cleaning and normalising
// ---------------------------------------------------------------------------------------------------------------

/** Strip Discord syntax (mentions, channel/emoji tags, urls) and markdown (bold, spoilers, code). */
export function stripDiscordSyntax(raw: string): string {
  return raw
    .replace(/<a?:\w+:\d+>/g, " ") // custom emoji
    .replace(/<[@#][!&]?\d+>/g, " ") // user / role / channel mentions
    .replace(/@(?:everyone|here)/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\|\|/g, " ")
    .replace(/[*_~`]{1,3}/g, (m) => (m.includes("_") ? " " : "")) // bold/italic/strike/code; keep text, treat _ as space
    .replace(/\s+/g, " ")
    .trim();
}

const TRUE_EMOJI = /[✅\u{1F44D}]/gu; // ✅ 👍
const FALSE_EMOJI = /[❌\u{1F44E}]/gu; // ❌ 👎

/** Normalise free text: NFKD, no diacritics, lowercase, `&` -> and, apostrophes dropped, punctuation -> space. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['‘’‛ʼ`´]/g, "") // papa john's -> papa johns
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Same as normalizeText but a possessive "'s" is dropped entirely (papa john's -> papa john). */
function normalizeDroppingPossessive(s: string): string {
  return normalizeText(s.replace(/['‘’‛ʼ`´]s\b/gi, ""));
}

const FILLER = new Set([
  "its", "it", "is", "was", "i", "think", "guess", "say", "answer", "the", "a", "an", "maybe", "probably",
  "um", "uh", "hmm", "definitely", "thats", "that", "so",
]);

function tokens(norm: string): string[] {
  return norm ? norm.split(" ").filter(Boolean) : [];
}

function stripLeadingFiller(toks: string[]): string[] {
  let i = 0;
  while (i < toks.length - 1 && FILLER.has(toks[i])) i++; // never strip to nothing
  return toks.slice(i);
}

/** Canonical token list for comparison: normalised, leading filler removed. */
function canon(s: string): string[] {
  return stripLeadingFiller(tokens(normalizeText(s)));
}
function canonDroppingPossessive(s: string): string[] {
  return stripLeadingFiller(tokens(normalizeDroppingPossessive(s)));
}

/** The forms a string can take when compared: with and without possessive "'s". */
function variants(s: string): string[] {
  const a = canon(s).join(" ");
  const b = canonDroppingPossessive(s).join(" ");
  return a === b ? [a] : [a, b];
}

// ---------------------------------------------------------------------------------------------------------------
// Edit distance (Damerau-Levenshtein, optimal string alignment)
// ---------------------------------------------------------------------------------------------------------------

export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const d: number[][] = Array.from({ length: al + 1 }, () => new Array<number>(bl + 1).fill(0));
  for (let i = 0; i <= al; i++) d[i][0] = i;
  for (let j = 0; j <= bl; j++) d[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[al][bl];
}

/** Allowed edit distance for a target of this normalised length: <=4 exact, 5-8 one, 9-15 two, longer three. */
export function fuzzyThreshold(len: number): number {
  if (len <= 4) return 0;
  if (len <= 8) return 1;
  if (len <= 15) return 2;
  return 3;
}

// ---------------------------------------------------------------------------------------------------------------
// Boolean
// ---------------------------------------------------------------------------------------------------------------

const TRUE_WORDS = new Set(["true", "t", "yes", "y", "yep", "yeah", "correct", "right"]);
const FALSE_WORDS = new Set(["false", "f", "no", "n", "nope", "wrong", "incorrect"]);

// Discord rounds run in a busy chat channel, so only explicit tokens count there: yes/no/yeah/right/wrong/y/n and
// thumbs are everyday chat, not answers. Typos of true/false still match.
const STRICT_TRUE = new Set(["true", "t"]);
const STRICT_FALSE = new Set(["false", "f"]);

/** true / false, or null when it is not an answer. Fuzzy (<= 1) only against "true" and "false" themselves. `strict`: Discord rules. */
export function parseBoolean(cleaned: string, strict = false): boolean | null {
  const withEmoji = strict ? cleaned : cleaned.replace(TRUE_EMOJI, " true ").replace(FALSE_EMOJI, " false ");
  const toks = canon(withEmoji);
  if (toks.length !== 1) return null;
  const w = toks[0];
  if ((strict ? STRICT_TRUE : TRUE_WORDS).has(w)) return true;
  if ((strict ? STRICT_FALSE : FALSE_WORDS).has(w)) return false;
  if (w.length >= 4) {
    if (editDistance(w, "true") <= 1) return true;
    if (editDistance(w, "false") <= 1) return false;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------------------------------------------

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES: Record<string, number> = { thousand: 1e3, million: 1e6, mil: 1e6, billion: 1e9 };
const SUFFIX: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, thousand: 1e3, million: 1e6, mil: 1e6, billion: 1e9 };

/** Words that may sit inside a number phrase. */
function isNumberWord(w: string): boolean {
  return w in UNITS || w in TENS || w in SCALES || w === "hundred" || w === "and";
}

/** "one hundred million" -> 1e8, "ten thousand" -> 10000. Null if the tokens are not a clean number phrase. */
function wordsToNumber(words: string[]): number | null {
  let total = 0;
  let current = 0;
  let any = false;
  for (const w of words) {
    if (w === "and") continue;
    if (w in UNITS) {
      current += UNITS[w];
      any = true;
    } else if (w in TENS) {
      current += TENS[w];
      any = true;
    } else if (w === "hundred") {
      if (!any) return null;
      current = (current || 1) * 100;
    } else if (w in SCALES) {
      if (!any) return null;
      total += (current || 1) * SCALES[w];
      current = 0;
    } else return null;
  }
  return any ? total + current : null;
}

/**
 * Candidate values for one digit string like "9,900", "9.900", "9 900", "0.99", "1,5", ".99".
 * Groups of exactly three digits after a separator are thousands separators; anything else with a single
 * separator is a decimal. "x.yyy" (three digits after a dot) is genuinely ambiguous (3.125 vs 3,125), so
 * both readings are offered, except after a leading 0 (0.125 is a decimal). A comma plus three digits is thousands only.
 */
function digitCandidates(s: string): number[] {
  const t = s.trim();
  if (/^\d+$/.test(t)) return [Number(t)];
  // Several groups of three digits with one separator: thousands separators only (9,900,000 / 9.900.000 / 9 900 000).
  if (/^\d{1,3}([,._ ])\d{3}(\1\d{3})+$/.test(t)) return [Number(t.replace(/[,._ ]/g, ""))];
  // 1,234.56 and 1.234,56
  const en = t.match(/^(\d{1,3}(?:,\d{3})+)\.(\d+)$/);
  if (en) return [Number(`${en[1].replace(/,/g, "")}.${en[2]}`)];
  const eu = t.match(/^(\d{1,3}(?:\.\d{3})+),(\d+)$/);
  if (eu) return [Number(`${eu[1].replace(/\./g, "")}.${eu[2]}`)];
  // "9 900"
  const spaced = t.match(/^(\d{1,3}) (\d{3})$/);
  if (spaced) return [Number(spaced[1] + spaced[2])];
  // One separator: thousands (exactly three digits after it) or a decimal.
  const one = t.match(/^(\d*)([,.])(\d+)$/);
  if (!one) return [];
  const [, head, sep, tail] = one;
  const decimal = Number(`${head || "0"}.${tail}`);
  if (tail.length === 3 && head.length > 0) {
    const thousands = Number(head + tail);
    if (sep === ",") return [thousands];
    return head === "0" ? [decimal] : [thousands, decimal];
  }
  return [decimal];
}

/**
 * Each number the text contains, as candidate readings (see digitCandidates). Handles k/m/b and
 * thousand/million/billion suffixes, e8, 10^8 and number words. Currency and unit words (btc, sats,
 * %, minutes, "block", "around"...) are ignored: the aliases in the bank use the same parser, so a
 * unit does not change a value.
 */
export function parseNumbers(cleaned: string): number[][] {
  const text = normalizeNumberText(cleaned);
  const found: number[][] = [];

  // Digits first (with optional scale suffix), then word-numbers in what is left.
  const DIGITS = /(\d+\^\d+|\d+(?:\.\d+)?e\d+|\d{1,3}(?:[ ,._]\d{3})+(?:[.,]\d+)?|\d*[.,]\d+|\d+)(?:\s*(thousand|million|billion|mil|k|m|b)\b)?/g;
  let rest = text;
  let m: RegExpExecArray | null;
  const spans: [number, number][] = [];
  while ((m = DIGITS.exec(text)) !== null) {
    const [whole, num, suffix] = m;
    spans.push([m.index, m.index + whole.length]);
    let cands: number[];
    if (num.includes("^")) {
      const [b, e] = num.split("^").map(Number);
      cands = [Math.pow(b, e)];
    } else if (/e\d+$/.test(num) && !/[,._ ]/.test(num)) cands = [Number(num)];
    else cands = digitCandidates(num);
    if (suffix) cands = cands.map((c) => c * SUFFIX[suffix]);
    if (cands.length) found.push(cands);
  }
  if (spans.length) {
    // Blank out the digit spans so number words are only read from the remainder.
    const chars = text.split("");
    for (const [a, b] of spans) for (let i = a; i < b; i++) chars[i] = " ";
    rest = chars.join("");
  }

  // Number words: runs of consecutive number words.
  const words = rest.split(/[^a-z]+/).filter(Boolean);
  let run: string[] = [];
  const flush = () => {
    if (run.length) {
      // a lone "and" is not a number
      const v = wordsToNumber(run);
      if (v !== null) found.push([v]);
    }
    run = [];
  };
  for (const w of words) {
    if (isNumberWord(w) && !(w === "and" && run.length === 0)) run.push(w);
    else flush();
  }
  flush();
  return found;
}

/** Lowercase, strip diacritics, drop currency symbols, keep the characters number parsing needs. */
function normalizeNumberText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[$€£%+~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function numbersEqual(a: number, b: number, tolerance: number): boolean {
  // Relative epsilon only guards float representation (0.1 + 0.2); it never makes 9,800 match 9,900.
  return Math.abs(a - b) <= tolerance + 1e-9 * Math.max(1, Math.abs(b));
}

function matchNumber(q: MatchableQuestion, cleaned: string): Verdict {
  const given = parseNumbers(cleaned);
  if (given.length !== 1) return "ignore"; // none: chatter; several: ambiguous, not an answer
  const tolerance = q.match.tolerance ?? 0;
  const readings = given[0];

  // Rejects are matched on value, exactly, and beat the answer.
  for (const r of q.rejects) {
    for (const rn of parseNumbers(r).flat()) if (readings.some((g) => numbersEqual(g, rn, 0))) return "wrong";
  }
  const targets = [q.answer, ...q.aliases].flatMap((t) => parseNumbers(t).flat());
  if (targets.length === 0) targets.push(Number(q.answer));
  return readings.some((g) => targets.some((t) => numbersEqual(g, t, tolerance))) ? "correct" : "wrong";
}

// ---------------------------------------------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------------------------------------------

const NEGATIONS = new Set(["not", "isnt", "wasnt", "no", "never", "dont", "didnt", "cant", "nor", "except"]);

/** Words that may surround an answer without changing it ("I think it was jercos"). */
const HARMLESS = new Set([
  ...FILLER,
  "im", "believe", "bet", "pretty", "sure", "pls", "please", "thanks", "thank", "you", "lol", "yeah", "yes", "of", "for",
]);

function containsSequence(hay: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/** Whole-input equality or fuzzy equality against one target. `maxFuzz` caps the scaled threshold. */
function nearlyEqual(input: string, target: string, fuzzy: boolean, maxFuzz = 3): boolean {
  if (input === target) return true;
  if (!fuzzy || !target || !input) return false;
  if (/\d/.test(target) || /\d/.test(input)) return false; // never fuzzy on digits: "over 100 million" is not "over 1 million"
  const allowed = Math.min(maxFuzz, fuzzyThreshold(target.length));
  return allowed > 0 && editDistance(input, target) <= allowed;
}

/**
 *  - "wrong":   the input is, or contains, a reject (a list of guesses that includes one is wrong)
 *  - "exact":   the whole input equals (or is fuzzily close to) the answer or an alias
 *  - "contain": the input contains an answer/alias as a whole-word sequence, with no negation, and every other word
 *               is harmless filler or a word of the question's own answers (so "mccaleb jed" and "it was jercos"
 *               pass, but "times of india", "hal finney jed mccaleb gavin" and "satoshin@gmx.de" do not)
 *  - "none":    nothing matched
 */
type TextLevel = "wrong" | "exact" | "contain" | "none";

function textLevel(inputRaw: string, targets: string[], rejects: string[], fuzzy: boolean): TextLevel {
  const inVariants = variants(inputRaw).filter(Boolean);
  if (inVariants.length === 0) return "none";

  // 1. The whole input is (nearly) a reject: wrong, and it beats aliases.
  const rejectVariants = rejects.flatMap((r) => variants(r).filter(Boolean));
  for (const rv of rejectVariants) if (inVariants.some((iv) => nearlyEqual(iv, rv, fuzzy, 1))) return "wrong";
  // 2. The whole input is an answer or alias.
  const targetVariants = targets.flatMap((t) => variants(t).filter(Boolean));
  for (const tv of targetVariants) if (inVariants.includes(tv)) return "exact";
  if (fuzzy) for (const tv of targetVariants) if (inVariants.some((iv) => nearlyEqual(iv, tv, true))) return "exact";
  // 3. The input contains a reject ("windows mac linux"): wrong, unless that reject is just part of an answer that the
  //    input also contains ("pineapple" inside "pineapple jalapeno pizza").
  for (const iv of inVariants) {
    const inTokens = iv.split(" ");
    const containedTargets = targetVariants.filter((tv) => containsSequence(inTokens, tv.split(" ")));
    for (const rv of rejectVariants) {
      const rTokens = rv.split(" ");
      if (!containsSequence(inTokens, rTokens)) continue;
      if (containedTargets.some((tv) => containsSequence(tv.split(" "), rTokens))) continue;
      return "wrong";
    }
  }

  const vocab = new Set<string>(HARMLESS);
  for (const tv of targetVariants) for (const w of tv.split(" ")) vocab.add(w);
  for (const iv of inVariants) {
    const inTokens = iv.split(" ");
    if (inTokens.some((t) => NEGATIONS.has(t))) continue;
    for (const tv of targetVariants) {
      const tTokens = tv.split(" ");
      if (!containsSequence(inTokens, tTokens)) continue;
      // Every word outside one occurrence of the target must be harmless or part of the answers' own vocabulary.
      const rest = removeSequence(inTokens, tTokens);
      if (rest.every((w) => vocab.has(w))) return "contain";
    }
  }
  return "none";
}

function removeSequence(hay: string[], needle: string[]): string[] {
  for (let i = 0; i + needle.length <= hay.length; i++) {
    if (needle.every((w, j) => hay[i + j] === w)) return [...hay.slice(0, i), ...hay.slice(i + needle.length)];
  }
  return hay;
}

function matchText(q: MatchableQuestion, cleaned: string): Verdict {
  const level = textLevel(cleaned, [q.answer, ...q.aliases], q.rejects, q.match.fuzzy ?? false);
  return level === "exact" || level === "contain" ? "correct" : "wrong"; // a wrong guess counts as an attempt
}

// ---------------------------------------------------------------------------------------------------------------
// Multiple choice
// ---------------------------------------------------------------------------------------------------------------

const LETTER_EMOJI: Record<string, number> = { "\u{1F170}": 0, "\u{1F171}": 1, "\u{1F172}": 2, "\u{1F173}": 3 }; // 🅰 🅱 🅲 🅳

/** A letter answer (b, (b), b), b., option b, 🅱️) as a choice index, or null. */
export function parseChoiceLetter(cleaned: string): number | null {
  const stripped = cleaned.replace(/️/g, "").trim();
  if (stripped in LETTER_EMOJI) return LETTER_EMOJI[stripped];
  const m = stripped.toLowerCase().match(/^(?:(?:option|choice|answer)\s+)?[([]?\s*([a-d])\s*[)\].:!]*$/);
  return m ? m[1].charCodeAt(0) - 97 : null;
}

/** The words of a string that carry meaning (normalised, filler removed). */
function contentTokens(s: string): string[] {
  return tokens(normalizeText(s)).filter((w) => !HARMLESS.has(w));
}

/**
 * Multiple choice. A letter picks a choice. Otherwise the input is matched against the answer, but an input that
 * names more than one choice (a list of guesses) is wrong, and one that only half-names a choice ("under 70%") is
 * wrong, not an ignored message: a failed attempt must not be free. Chit-chat that touches no choice is ignored.
 */
function matchChoice(q: MatchableQuestion, cleaned: string): Verdict {
  const choices = q.choices ?? [];
  const answerForms = variants(q.answer);
  const letter = parseChoiceLetter(cleaned);
  if (letter !== null) {
    if (letter >= choices.length) return "ignore";
    return variants(choices[letter]).some((v) => answerForms.includes(v)) ? "correct" : "wrong";
  }
  const fuzzy = q.match.fuzzy ?? true;
  const level = textLevel(cleaned, [q.answer, ...q.aliases], q.rejects, fuzzy);
  if (level === "wrong") return "wrong";
  if (level === "exact") return "correct";

  // Which choices does the input touch (shares a meaningful word with)?
  const inWords = new Set(contentTokens(cleaned));
  const touched = choices.filter((c) => contentTokens(c).some((w) => inWords.has(w)));
  if (touched.length >= 2) return "wrong";
  if (level === "contain") return "correct";
  return touched.length === 1 ? "wrong" : "ignore";
}

// ---------------------------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------------------------

export interface MatchOptions {
  /** Discord rounds: true/false questions accept only true, false, t, f and typos of true/false (see parseBoolean). */
  strictBoolean?: boolean;
}

export function match(question: MatchableQuestion, raw: unknown, opts: MatchOptions = {}): MatchResult {
  try {
    if (typeof raw !== "string") return { verdict: "ignore" };
    const cleaned = stripDiscordSyntax(raw);
    if (!cleaned || cleaned.length > MAX_ANSWER_CHARS) return { verdict: "ignore" };
    if (cleaned.split(/\s+/).length > MAX_TOKENS) return { verdict: "ignore" };

    switch (question.match.kind) {
      case "boolean": {
        const given = parseBoolean(cleaned, opts.strictBoolean === true);
        if (given === null) return { verdict: "ignore" };
        return { verdict: given === (question.answer === "true") ? "correct" : "wrong" };
      }
      case "number":
        return { verdict: matchNumber(question, cleaned) };
      case "choice":
        return { verdict: matchChoice(question, cleaned) };
      case "text":
        return { verdict: matchText(question, cleaned) };
      default:
        return { verdict: "ignore" };
    }
  } catch {
    return { verdict: "ignore" };
  }
}
