// app/lib/trivia/suggestion-core.ts
//
// Community question suggestions (plans/trivia.md section 10, phase 3), the pure half: validation of what a member typed
// (Discord modal or web form) and the draft bank entry "Add to bank" creates (suggestions.ts addSuggestionToBank). No
// database, no network: suggestions.ts stores them as TriviaReport rows with kind = "suggestion".
import { CATEGORIES, QuestionSchema, type TriviaCategory, type TriviaQuestion } from "./schema";

export const SUGGEST_QUESTION_MIN = 8;
export const SUGGEST_QUESTION_MAX = 300;
export const SUGGEST_ANSWER_MAX = 120;
export const SUGGEST_ALIAS_MAX = 80;
export const SUGGEST_ALIASES_MAX = 8;
export const SUGGEST_SOURCE_MAX = 300;
/** Suggestions one member may send per rolling 24 hours. */
export const SUGGESTIONS_PER_DAY = 5;

export interface SuggestionInput {
  question: unknown;
  answer: unknown;
  /** Comma or newline separated text, or an array. */
  aliases?: unknown;
  source: unknown;
  category?: unknown;
}

/** What is stored in TriviaReport.payload. */
export interface SuggestionPayload {
  question: string;
  answer: string;
  aliases: string[];
  source: string;
  category: TriviaCategory | null;
}

export type SuggestionError = "question" | "answer" | "aliases" | "source" | "category";
export type SuggestionValidation = { ok: true; value: SuggestionPayload } | { ok: false; error: SuggestionError };

const clean = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** "Bitcoin Pizza Day", "pizza_day" and "pizza-day" all find a category; anything else is not one. */
export function parseCategory(raw: unknown): TriviaCategory | null | "invalid" {
  const s = clean(raw).toLowerCase();
  if (!s) return null;
  const slug = s.replace(/[\s_]+/g, "-");
  const names: Record<string, TriviaCategory> = { "bitcoin-pizza-day": "pizza-day", "early-bitcoin": "early-bitcoin", "bitcoin-protocol": "protocol", "just-for-fun": "just-for-fun" };
  const hit = (CATEGORIES as readonly string[]).includes(slug) ? (slug as TriviaCategory) : names[slug];
  return hit ?? "invalid";
}

function parseAliases(raw: unknown): string[] | null {
  const parts = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,\n;]/) : raw == null ? [] : null;
  if (!parts) return null;
  const out: string[] = [];
  for (const p of parts) {
    const a = clean(p);
    if (a && !out.some((x) => x.toLowerCase() === a.toLowerCase())) out.push(a);
  }
  return out;
}

/** The source must be an http(s) URL with a host. */
export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname.includes(".");
  } catch {
    return false;
  }
}

export function validateSuggestion(input: SuggestionInput): SuggestionValidation {
  const question = clean(input.question);
  if (question.length < SUGGEST_QUESTION_MIN || question.length > SUGGEST_QUESTION_MAX) return { ok: false, error: "question" };
  const answer = clean(input.answer);
  if (!answer || answer.length > SUGGEST_ANSWER_MAX) return { ok: false, error: "answer" };
  const aliasesAll = parseAliases(input.aliases);
  if (!aliasesAll || aliasesAll.length > SUGGEST_ALIASES_MAX || aliasesAll.some((a) => a.length > SUGGEST_ALIAS_MAX)) return { ok: false, error: "aliases" };
  const aliases = aliasesAll.filter((a) => a.toLowerCase() !== answer.toLowerCase());
  const source = clean(input.source);
  if (!source || source.length > SUGGEST_SOURCE_MAX || !isHttpUrl(source)) return { ok: false, error: "source" };
  const category = parseCategory(input.category);
  if (category === "invalid") return { ok: false, error: "category" };
  return { ok: true, value: { question, answer, aliases, source, category } };
}

// ---------------------------------------------------------------------------------------------------------------
// The JSON snippet
// ---------------------------------------------------------------------------------------------------------------

/** The id prefix each category uses in the bank (satoshi shares "eb" with early-bitcoin, as the bank does today). */
const ID_PREFIX: Record<TriviaCategory, string> = {
  "pizza-day": "pd",
  jercos: "jc",
  "early-bitcoin": "eb",
  satoshi: "eb",
  protocol: "pr",
  "myth-busting": "mb",
  pizzadao: "pz",
  "just-for-fun": "fun",
};

/** The next free id for a category: highest number under its prefix, plus one (pd-019 -> pd-020). */
export function nextQuestionId(category: TriviaCategory, existingIds: Iterable<string>): string {
  const prefix = ID_PREFIX[category];
  let max = 0;
  for (const id of existingIds) {
    const m = /^([a-z]{2,4})-(\d{3})$/.exec(id);
    if (m && m[1] === prefix) max = Math.max(max, Number(m[2]));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

/** The category used when the member gave none: the admin changes it while reviewing. */
export const DEFAULT_SUGGESTION_CATEGORY: TriviaCategory = "pizzadao";

/**
 * A draft entry in the exact bank schema (QuestionSchema). It is `status: "flagged"` (not served: a reviewer
 * checks the sources and flips it to approved with a pool, as plans/trivia.md section 10 says) and the fields a member
 * cannot know (difficulty, explanation) are placeholders to edit. The type and matcher are inferred from the answer.
 * Always parses with QuestionSchema (suggestion tests enforce it).
 */
export function buildQuestionSnippet(s: SuggestionPayload, existingIds: Iterable<string>, suggestionId?: number): TriviaQuestion {
  const category = s.category ?? DEFAULT_SUGGESTION_CATEGORY;
  const lower = s.answer.toLowerCase();
  const numeric = /^-?\d[\d,]*(\.\d+)?$/.test(s.answer);
  const isBool = lower === "true" || lower === "false";
  const base = {
    id: nextQuestionId(category, existingIds),
    category,
    difficulty: "medium" as const,
    question: s.question,
    rejects: [] as string[],
    explanation: "TODO: one or two sentences that explain the answer.",
    sources: [{ url: s.source.replace(/^http:\/\//i, "https://"), note: "Community suggestion: check this source supports the answer" }],
    notes: `Community suggestion${suggestionId ? ` #${suggestionId}` : ""}.${s.category ? "" : " No category was given: check it."} Needs review before it is approved.${/^http:\/\//i.test(s.source) ? " The source was http: confirm the https version." : ""}`,
    status: "flagged" as const,
  };
  const aliases = s.aliases;
  const label = category === "just-for-fun" ? { label: "Just for fun" } : {};
  if (isBool) return { ...base, ...label, type: "true_false", answer: lower, aliases: [], match: { kind: "boolean" } };
  if (numeric) return { ...base, ...label, type: "short_answer", answer: s.answer.replace(/,/g, ""), aliases, match: { kind: "number", tolerance: 0 } };
  return { ...base, ...label, type: "short_answer", answer: s.answer, aliases, match: { kind: "text", fuzzy: s.answer.length > 4 } };
}

/** The draft as pretty JSON (the admin queue's preview). Throws if it would not pass the bank schema. */
export function snippetJson(s: SuggestionPayload, existingIds: Iterable<string>, suggestionId?: number): string {
  const q = buildQuestionSnippet(s, existingIds, suggestionId);
  QuestionSchema.parse(q);
  return JSON.stringify(q, null, 2);
}
